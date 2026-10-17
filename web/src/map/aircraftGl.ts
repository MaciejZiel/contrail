import { buildAtlas, COLS, ROWS } from "./sprites";

/** Floats per instance: x, y, rotation, size, packed colour, sprite cell. */
export const STRIDE_FLOATS = 6;

const VERT = `#version 300 es
layout(location=0) in vec2 a_corner;
layout(location=1) in vec4 a_pos;
layout(location=2) in vec4 a_color;
layout(location=3) in float a_cell;
uniform vec2 u_view;
out vec2 v_uv;
out vec4 v_color;
void main() {
  float c = cos(a_pos.z);
  float s = sin(a_pos.z);
  vec2 p = a_corner * a_pos.w;
  vec2 px = a_pos.xy + vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  gl_Position = vec4(px.x / u_view.x * 2.0 - 1.0, 1.0 - px.y / u_view.y * 2.0, 0.0, 1.0);
  vec2 cell = vec2(mod(a_cell, ${COLS}.0), floor(a_cell / ${COLS}.0));
  v_uv = (cell + a_corner + 0.5) / vec2(${COLS}.0, ${ROWS}.0);
  v_color = a_color;
}`;

const FRAG = `#version 300 es
precision mediump float;
uniform sampler2D u_atlas;
in vec2 v_uv;
in vec4 v_color;
out vec4 outColor;
void main() {
  vec4 t = texture(u_atlas, v_uv);
  float any = t.g;
  if (any < 0.02) discard;
  vec3 rgb = mix(vec3(0.03, 0.04, 0.05), v_color.rgb, clamp(t.r / max(any, 0.001), 0.0, 1.0));
  float a = any * v_color.a;
  outColor = vec4(rgb * a, a);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error("shader allocation failed");
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(`shader error: ${gl.getShaderInfoLog(sh)}`);
  }
  return sh;
}

/** Instanced-quad renderer on its own canvas. All sizes are CSS pixels; the drawing buffer is DPR scaled. */
export class AircraftGl {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private instanceBuffer: WebGLBuffer;
  private uView: WebGLUniformLocation;
  private capacityBytes = 0;
  private cssW = 1;
  private cssH = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) throw new Error("WebGL2 is not available");
    this.gl = gl;
    const program = gl.createProgram();
    if (!program) throw new Error("program allocation failed");
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`program link error: ${gl.getProgramInfoLog(program)}`);
    }
    this.program = program;
    this.uView = gl.getUniformLocation(program, "u_view") as WebGLUniformLocation;

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const inst = gl.createBuffer();
    if (!inst) throw new Error("buffer allocation failed");
    this.instanceBuffer = inst;
    gl.bindBuffer(gl.ARRAY_BUFFER, inst);
    const stride = STRIDE_FLOATS * 4;
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, stride, 16);
    gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 20);
    gl.vertexAttribDivisor(3, 1);

    const atlas = buildAtlas();
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, atlas.width, atlas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, atlas.data);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  /** Match the drawing buffer to the CSS size and device pixel ratio. */
  resize(cssW: number, cssH: number, dpr: number): void {
    this.cssW = Math.max(1, cssW);
    this.cssH = Math.max(1, cssH);
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  draw(instances: Float32Array, count: number): void {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (count === 0) return;
    gl.useProgram(this.program);
    gl.uniform2f(this.uView, this.cssW, this.cssH);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    const bytes = count * STRIDE_FLOATS * 4;
    if (bytes > this.capacityBytes) {
      this.capacityBytes = Math.max(bytes, this.capacityBytes * 2);
      gl.bufferData(gl.ARRAY_BUFFER, this.capacityBytes, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, instances, 0, count * STRIDE_FLOATS);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
  }

  /** Test hook: number of non-transparent pixels in the drawing buffer. */
  readCoveredPixels(): number {
    const gl = this.gl;
    const px = new Uint8Array(this.canvas.width * this.canvas.height * 4);
    gl.readPixels(0, 0, this.canvas.width, this.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let n = 0;
    for (let i = 3; i < px.length; i += 4) if ((px[i] ?? 0) > 16) n++;
    return n;
  }
}
