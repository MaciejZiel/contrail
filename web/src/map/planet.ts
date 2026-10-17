import type { Map as MapLibreMap } from "maplibre-gl";
import { clamp } from "../core/geo";
import dayUrl from "../assets/earth-day.jpg?url";
import nightUrl from "../assets/earth-night.jpg?url";
import { GlobeShading } from "./globeShading";
import { subsolarPoint, sunInView } from "./sun";

const VERT = `#version 300 es
in vec2 a;
void main() { gl_Position = vec4(a, 0.0, 1.0); }`;

/**
 * The Earth as seen from space: for every pixel a ray from the same pinhole camera the aircraft layer uses is
 * intersected with the sphere, the hit point becomes a longitude and latitude, and those pick the daytime or the
 * night-time picture. The Sun's real position decides which of the two is seen; the terminator is a soft ramp.
 */
const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uDay;
uniform sampler2D uNight;
uniform vec2 uCenter;   // screen centre, device pixels
uniform float uScale;   // device pixels per CSS pixel
uniform float uR;       // sphere radius, CSS px
uniform float uA;       // camera height above the sphere, CSS px
uniform float uRim;     // outline radius, CSS px
uniform float uLat0;
uniform float uLon0;
uniform vec3 uSun;      // camera frame: x east, y north, z towards the viewer
uniform float uOpacity;
uniform float uZoom;
out vec4 outColor;

const float PI = 3.14159265358979;

void main() {
  vec2 d = (gl_FragCoord.xy - uCenter) / uScale;
  float rr = length(d);
  vec3 sunDir = normalize(uSun);
  vec3 col = vec3(0.0);
  float alpha = 0.0;

  // atmosphere outside the disc: brighter on the lit side
  float lit2 = clamp(dot(rr > 0.0 ? d / rr : vec2(0.0), sunDir.xy) * 0.9 + 0.35 * sunDir.z + 0.35, 0.0, 1.0);
  float ring = max(10.0, uRim * 0.06);
  float outside = rr - uRim;
  float glow = exp(-max(outside, 0.0) / (ring * 0.55)) * 0.62;
  vec3 atmo = mix(vec3(0.10, 0.22, 0.48), vec3(0.34, 0.60, 1.0), lit2);

  if (rr < uRim + 0.75) {
    vec3 dir = normalize(vec3(d, -uA));
    float D = uR + uA;
    float b = D * dir.z;
    float c = D * D - uR * uR;
    float disc = max(b * b - c, 0.0);
    float t = -b - sqrt(disc);
    vec3 p = vec3(0.0, 0.0, D) + t * dir;
    vec3 n = p / uR;
    float sl = sin(uLat0);
    float cl = cos(uLat0);
    float sinLat = clamp(n.y * cl + n.z * sl, -1.0, 1.0);
    float lat = asin(sinLat);
    float dl = atan(n.x, n.z * cl - n.y * sl);
    float lon = uLon0 + dl;
    float u = fract(lon / (2.0 * PI) + 0.5);
    float v = 0.5 - lat / PI;
    // sample with gradients from a seam-free coordinate so the texture does not flicker at the date line
    float u2 = fract(u + 0.5) - 0.5;
    vec2 gx = vec2(dFdx(abs(u - 0.5) > 0.25 ? u2 : u), dFdx(v));
    vec2 gy = vec2(dFdy(abs(u - 0.5) > 0.25 ? u2 : u), dFdy(v));
    vec3 day = textureGrad(uDay, vec2(u, v), gx, gy).rgb;
    vec3 night = textureGrad(uNight, vec2(u, v), gx, gy).rgb;

    float light = dot(n, sunDir);
    float lit = smoothstep(-0.10, 0.34, light);
    // the day side: gentle shading towards the terminator, never harsh
    vec3 dayCol = day * (0.55 + 0.6 * smoothstep(0.0, 0.9, light));
    dayCol = pow(dayCol, vec3(0.95));
    // the night side: city lights lifted, the land only just visible by starlight
    // the dim violet of the unlit land is pushed down, the lights stay
    vec3 nightCol = pow(night, vec3(1.45)) * vec3(4.6, 4.0, 3.2) * mix(1.0, 0.45, smoothstep(2.8, 4.8, uZoom)) + day * vec3(0.010, 0.018, 0.035);
    vec3 surf = mix(nightCol, dayCol, lit);

    // ocean glint where the surface mirrors the Sun towards the viewer
    float ocean = clamp((day.b - day.r * 1.25) * 5.0, 0.0, 1.0);
    vec3 h = normalize(sunDir + vec3(0.0, 0.0, 1.0) * 0.9 + normalize(vec3(0.0) - dir) * 0.1);
    float spec = pow(max(dot(n, h), 0.0), 60.0) * ocean * smoothstep(0.0, 0.4, light);
    surf += vec3(0.75, 0.85, 1.0) * spec * 0.5;

    // warm rose where the Sun has just set, strongest in a narrow band around the terminator
    float dusk = exp(-((light / 0.16) * (light / 0.16)));
    surf += vec3(0.30, 0.13, 0.07) * dusk * 0.28 * (1.0 - nightCol.r) * smoothstep(-0.3, 0.1, light + 0.1);

    // atmosphere in front of the limb: the surface is seen through more air towards the edge
    float fres = pow(1.0 - clamp(n.z, 0.0, 1.0), 2.6);
    surf = mix(surf, atmo * (0.25 + 0.75 * lit2), fres * 0.55 * (0.35 + 0.65 * lit));
    col = surf;
    float cover = clamp(uRim - rr + 0.5, 0.0, 1.0);
    // blend the glow in under the antialiased edge
    col = mix(atmo * glow, col, cover);
    alpha = max(cover, glow);
    col = cover > 0.0 ? col : atmo * glow;
  } else {
    col = atmo * glow;
    alpha = glow;
  }
  // premultiplied output
  outColor = vec4(col * uOpacity, alpha * uOpacity);
}`;

export class PlanetLayer {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private ready = false;
  private running = false;
  private key = "";
  private day: WebGLTexture | null = null;
  private night: WebGLTexture | null = null;

  constructor(private map: MapLibreMap, after: Element) {
    const c = document.createElement("canvas");
    c.className = "globe-planet";
    c.setAttribute("aria-hidden", "true");
    c.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
    const gl = c.getContext("webgl2", { premultipliedAlpha: true, alpha: true, antialias: false });
    if (!gl) throw new Error("WebGL2 unavailable");
    this.canvas = c;
    this.gl = gl;
    after.after(c);
    this.program = this.compile();
    for (const name of ["uDay", "uNight", "uCenter", "uScale", "uR", "uA", "uRim", "uLat0", "uLon0", "uSun", "uOpacity", "uZoom"]) {
      this.uniforms[name] = gl.getUniformLocation(this.program, name);
    }
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.program, "a");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    void Promise.all([this.load(dayUrl), this.load(nightUrl)]).then(([d, n]) => {
      if (!this.running && !this.canvas.isConnected) return;
      this.day = d;
      this.night = n;
      this.ready = true;
      this.key = "";
      this.draw();
    });
  }

  private compile(): WebGLProgram {
    const gl = this.gl;
    const make = (type: number, src: string): WebGLShader => {
      const s = gl.createShader(type);
      if (!s) throw new Error("shader");
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader error");
      return s;
    };
    const p = gl.createProgram();
    if (!p) throw new Error("program");
    gl.attachShader(p, make(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, make(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link error");
    return p;
  }

  private load(url: string): Promise<WebGLTexture> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const gl = this.gl;
        const t = gl.createTexture();
        if (!t) return reject(new Error("texture"));
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
        if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 4);
        resolve(t);
      };
      img.onerror = () => reject(new Error(`cannot load ${url}`));
      img.src = url;
    });
  }

  /** How much of the picture shows at this zoom: all of it for the whole-globe views, none once the vector map takes over. */
  static opacityAt(zoom: number): number {
    return clamp((5.6 - zoom) / 1.4, 0, 1);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.map.on("render", this.draw);
    this.draw();
  }

  stop(): void {
    this.running = false;
    this.map.off("render", this.draw);
    this.canvas.remove();
    const gl = this.gl;
    gl.deleteTexture(this.day);
    gl.deleteTexture(this.night);
    gl.deleteProgram(this.program);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  private draw = (): void => {
    if (!this.ready) return;
    const container = this.map.getContainer();
    const w = container.clientWidth;
    const h = container.clientHeight;
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const zoom = this.map.getZoom();
    const c = this.map.getCenter();
    const minute = Math.floor(Date.now() / 60000);
    const opacity = PlanetLayer.opacityAt(zoom);
    const key = `${w}x${h}@${dpr}|${zoom.toFixed(3)}|${c.lat.toFixed(3)}|${c.lng.toFixed(3)}|${minute}`;
    if (key === this.key) return;
    this.key = key;
    const gl = this.gl;
    const cv = this.canvas;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    gl.viewport(0, 0, cv.width, cv.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (opacity <= 0) return;
    const view = GlobeShading.view(zoom, c.lat, h);
    if (view.rim > 3 * Math.max(w, h)) return;
    const sun = sunInView(subsolarPoint(new Date(minute * 60000)), c.lat, c.lng);
    const rad = Math.PI / 180;
    gl.useProgram(this.program);
    const U = this.uniforms;
    const u = (name: string): WebGLUniformLocation | null => U[name] ?? null;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.day);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.night);
    gl.uniform1i(u("uDay"), 0);
    gl.uniform1i(u("uNight"), 1);
    gl.uniform2f(u("uCenter"), (w / 2) * dpr, (h / 2) * dpr);
    gl.uniform1f(u("uScale"), dpr);
    gl.uniform1f(u("uR"), view.radius);
    gl.uniform1f(u("uA"), view.camera);
    gl.uniform1f(u("uRim"), view.rim);
    gl.uniform1f(u("uLat0"), c.lat * rad);
    gl.uniform1f(u("uLon0"), c.lng * rad);
    gl.uniform3f(u("uSun"), sun.sx, sun.sy, sun.sz);
    gl.uniform1f(u("uOpacity"), opacity);
    gl.uniform1f(u("uZoom"), zoom);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
}
