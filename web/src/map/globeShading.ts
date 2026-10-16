import type { Map as MapLibreMap } from "maplibre-gl";
import { clamp } from "../core/geo";
import { CITY_LIGHTS } from "./cityLights";
import { subsolarPoint, sunInView, sunLight } from "./sun";

const TILE_SIZE = 512;
/** Resolution of the night mask; it is smooth, so it is drawn scaled up. */
const MASK = 128;
const STAR_COUNT = 640;

interface Star {
  x: number;
  y: number;
  r: number;
  a: number;
  rgb: string;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fixed field of faint stars, a part of it thickened along a diagonal band like the Milky Way. */
function makeStars(): Star[] {
  const rnd = mulberry32(20261017);
  const out: Star[] = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    let x = rnd();
    let y = rnd();
    let boost = 1;
    if (rnd() < 0.38) {
      // along the band from lower left to upper right, spread sideways
      const t = rnd() * 1.3 - 0.15;
      const off = (rnd() + rnd() + rnd() - 1.5) * 0.12;
      x = t - off * 0.5;
      y = 0.85 - t * 0.7 + off;
      boost = 0.7; // band stars are fainter, so the band reads as haze
    }
    const k = rnd();
    const tint = rnd();
    out.push({
      x,
      y,
      r: 0.35 + k * k * k * 1.1,
      a: (0.14 + rnd() * 0.55) * boost,
      rgb: tint < 0.8 ? "236,241,255" : tint < 0.92 ? "255,226,192" : "192,212,255",
    });
  }
  return out;
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * What makes the globe look like a planet, in two canvases around the basemap:
 *  - behind it, faint stars (fixed: the sky does not move when the globe is turned);
 *  - on top of it, the night side. It is the real position of the Sun now: the dark half follows the clock,
 *    with a soft twilight band at the terminator, limb darkening and a thin atmosphere ring that is brighter on
 *    the lit side. All of it is low in contrast on purpose.
 * The geometry is the same pinhole model the aircraft layer uses (see AircraftLayer.drawGlobe).
 */
export class GlobeShading {
  private shade: HTMLCanvasElement;
  private shadeCtx: CanvasRenderingContext2D;
  private stars: HTMLCanvasElement;
  private starsCtx: CanvasRenderingContext2D;
  private mask = document.createElement("canvas");
  private ringCanvas = document.createElement("canvas");
  private sprite: HTMLCanvasElement | null = null;
  private maskCtx: CanvasRenderingContext2D;
  private starList = makeStars();
  private shadeKey = "";
  private starsKey = "";
  private running = false;

  constructor(private map: MapLibreMap, aircraftCanvas: Element | null) {
    const container = map.getContainer();
    const make = (cls: string): [HTMLCanvasElement, CanvasRenderingContext2D] => {
      const c = document.createElement("canvas");
      c.className = cls;
      c.setAttribute("aria-hidden", "true");
      c.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
      const ctx = c.getContext("2d");
      if (!ctx) throw new Error("2D canvas unavailable");
      return [c, ctx];
    };
    [this.shade, this.shadeCtx] = make("globe-shading");
    [this.stars, this.starsCtx] = make("globe-stars");
    container.insertBefore(this.shade, aircraftCanvas);
    container.insertBefore(this.stars, container.firstChild); // behind the basemap
    this.mask.width = MASK;
    this.mask.height = MASK;
    const m = this.mask.getContext("2d");
    if (!m) throw new Error("2D canvas unavailable");
    this.maskCtx = m;
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
    this.shade.remove();
    this.stars.remove();
  }

  /** Geometry shared with the aircraft layer: sphere radius, camera height and the outline radius, in pixels. */
  static view(zoom: number, lat: number, h: number): { radius: number; camera: number; rim: number } {
    const radius = (TILE_SIZE * 2 ** zoom) / (2 * Math.PI) / Math.max(0.05, Math.cos((lat * Math.PI) / 180));
    const camera = 1.5 * h;
    const distance = radius + camera;
    const horizon = Math.acos(radius / distance);
    const rim = (radius * Math.sin(horizon) * camera) / (distance - radius * Math.cos(horizon));
    return { radius, camera, rim };
  }

  /** Radius in pixels of the globe's outline on screen. */
  static silhouetteRadius(zoom: number, lat: number, h: number): number {
    return GlobeShading.view(zoom, lat, h).rim;
  }

  /** The zoom at which the outline has this radius (bisection; the radius grows with zoom). */
  static zoomForRadius(target: number, lat: number, h: number): number {
    let lo = -1;
    let hi = 6;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (GlobeShading.silhouetteRadius(mid, lat, h) < target) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  private size(): { w: number; h: number; dpr: number } {
    const c = this.map.getContainer();
    return { w: c.clientWidth, h: c.clientHeight, dpr: Math.min(1.25, window.devicePixelRatio || 1) };
  }

  private fit(cv: HTMLCanvasElement, w: number, h: number, dpr: number): void {
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
  }

  private draw = (): void => {
    const { w, h, dpr } = this.size();
    const c = this.map.getCenter();
    const zoom = this.map.getZoom();
    const minute = Math.floor(Date.now() / 60000);
    const fade = clamp((5.5 - zoom) / 2, 0, 1);
    this.drawStars(w, h, dpr, fade);
    this.drawShade(w, h, dpr, c.lng, c.lat, zoom, minute, fade);
  };

  /** The sky stays put while the globe is turned: stars are drawn once per window size. */
  private drawStars(w: number, h: number, dpr: number, fade: number): void {
    const key = `${w}x${h}@${dpr}|${fade > 0}`;
    if (key === this.starsKey) return;
    this.starsKey = key;
    this.fit(this.stars, w, h, dpr);
    const ctx = this.starsCtx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (fade <= 0) return;
    for (const s of this.starList) {
      ctx.fillStyle = `rgba(${s.rgb},${s.a})`;
      ctx.beginPath();
      ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawShade(w: number, h: number, dpr: number, lon: number, lat: number, zoom: number, minute: number, fade: number): void {
    const key = `${w}x${h}@${dpr}|${zoom.toFixed(3)}|${lat.toFixed(2)}|${lon.toFixed(2)}|${minute}`;
    if (key === this.shadeKey) return;
    this.shadeKey = key;
    this.fit(this.shade, w, h, dpr);
    const ctx = this.shadeCtx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const view = GlobeShading.view(zoom, lat, h);
    const r = view.rim;
    if (fade <= 0 || r > 3 * Math.max(w, h)) return;
    const cx = w / 2;
    const cy = h / 2;
    const sun = sunInView(subsolarPoint(new Date(minute * 60000)), lat, lon);
    // direction of the Sun on screen, as the canvas sees it (y down)
    const sunAngle = Math.atan2(-sun.sy, sun.sx);
    const lightAt = (a: number) => sun.sx * Math.cos(a) + sun.sy * Math.sin(a); // limb point at math angle a (y up)

    ctx.save();
    ctx.globalAlpha = fade;

    // atmosphere: a thin ring outside the edge, brighter on the lit side, nearly gone on the night side
    const ring = Math.max(10, r * 0.07);
    const outer = r + ring;
    const edge = (r * 0.985) / outer;
    const atmo = ctx.createRadialGradient(cx, cy, 0, cx, cy, outer);
    atmo.addColorStop(0, "rgba(110,155,215,0)");
    atmo.addColorStop(edge, "rgba(110,155,215,0)");
    atmo.addColorStop(Math.min(0.999, edge + 0.0001), "rgba(110,155,215,0.42)");
    atmo.addColorStop(Math.min(0.9995, edge + (1 - edge) * 0.4), "rgba(110,155,215,0.13)");
    atmo.addColorStop(1, "rgba(110,155,215,0)");
    const ringCanvas = this.ringCanvas;
    const ringPx = Math.round(2 * outer * dpr);
    if (ringCanvas.width !== ringPx) {
      ringCanvas.width = ringPx;
      ringCanvas.height = ringPx;
    } else {
      ringCanvas.getContext("2d")?.clearRect(0, 0, ringPx, ringPx);
    }
    const rc = ringCanvas.getContext("2d");
    if (rc && typeof rc.createConicGradient === "function") {
      rc.setTransform(dpr, 0, 0, dpr, 0, 0);
      rc.globalCompositeOperation = "source-over";
      const g = rc.createRadialGradient(outer, outer, 0, outer, outer, outer);
      for (const [pos, col] of [
        [0, "rgba(110,155,215,0)"],
        [edge, "rgba(110,155,215,0)"],
        [Math.min(0.999, edge + 0.0001), "rgba(110,155,215,0.42)"],
        [Math.min(0.9995, edge + (1 - edge) * 0.4), "rgba(110,155,215,0.13)"],
        [1, "rgba(110,155,215,0)"],
      ] as const) g.addColorStop(pos, col);
      rc.fillStyle = g;
      rc.fillRect(0, 0, 2 * outer, 2 * outer);
      // weight by how much light falls on the limb at each angle
      const cg = rc.createConicGradient(sunAngle - Math.PI, outer, outer);
      const steps = 36;
      for (let i = 0; i <= steps; i++) {
        const f = i / steps;
        const canvasAngle = sunAngle - Math.PI + f * Math.PI * 2;
        const mathAngle = -canvasAngle;
        const lit = 0.12 + 0.88 * smooth(-0.3, 0.45, lightAt(mathAngle));
        cg.addColorStop(f, `rgba(0,0,0,${lit})`);
      }
      rc.globalCompositeOperation = "destination-in";
      rc.fillStyle = cg;
      rc.fillRect(0, 0, 2 * outer, 2 * outer);
      ctx.drawImage(ringCanvas, cx - outer, cy - outer, 2 * outer, 2 * outer);
    } else {
      ctx.fillStyle = atmo;
      ctx.beginPath();
      ctx.arc(cx, cy, outer, 0, Math.PI * 2);
      ctx.fill();
    }

    // the night side: light at each point of the disc, from the Sun's real position
    const img = this.maskCtx.createImageData(MASK, MASK);
    const px = img.data;
    for (let j = 0; j < MASK; j++) {
      for (let i = 0; i < MASK; i++) {
        const u = ((i + 0.5) / MASK) * 2 - 1;
        const v = 1 - ((j + 0.5) / MASK) * 2;
        const o = (j * MASK + i) * 4;
        const light = sunLight(u, v, view, sun);
        if (light === null) {
          px[o + 3] = 0;
          continue;
        }
        // 0 in the night, 1 in the day; the twilight is a wide, soft ramp, not a line
        const day = smooth(-0.22, 0.26, light);
        // the sky glows a faint warm rose where the Sun has just set
        const dusk = Math.sin(Math.PI * day) ** 2;
        const a = (1 - day) ** 1.2 * 0.68;
        px[o] = 4 + dusk * 30;
        px[o + 1] = 8 + dusk * 8;
        px[o + 2] = 24 + dusk * 16;
        px[o + 3] = clamp(a, 0, 1) * 255;
      }
    }
    this.maskCtx.putImageData(img, 0, 0);

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(this.mask, cx - r, cy - r, 2 * r, 2 * r);

    this.drawCityLights(ctx, view, sun, lat, lon, cx, cy, r);

    // limb darkening on top: the sphere falls away towards its edge, a little less on the lit side
    const limb = ctx.createRadialGradient(cx, cy, r * 0.55, cx, cy, r);
    limb.addColorStop(0, "rgba(5,6,8,0)");
    limb.addColorStop(0.8, "rgba(5,6,8,0.12)");
    limb.addColorStop(1, "rgba(5,6,8,0.5)");
    ctx.fillStyle = limb;
    ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    ctx.restore();
    ctx.restore();
  }

  /** One soft warm dot, drawn once and scaled for every city. */
  private citySprite(): HTMLCanvasElement {
    if (this.sprite) return this.sprite;
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const x = c.getContext("2d");
    if (x) {
      const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, "rgba(255,214,150,1)");
      g.addColorStop(0.1, "rgba(255,170,90,0.4)");
      g.addColorStop(1, "rgba(255,150,70,0)");
      x.fillStyle = g;
      x.fillRect(0, 0, 64, 64);
    }
    return (this.sprite = c);
  }

  /** Warm city lights on the night side, from the same projection the aircraft use. */
  private drawCityLights(
    ctx: CanvasRenderingContext2D,
    view: { radius: number; camera: number },
    sun: { sx: number; sy: number; sz: number },
    lat0: number,
    lon0: number,
    cx: number,
    cy: number,
    r: number,
  ): void {
    const rad = Math.PI / 180;
    const p0 = lat0 * rad;
    const sinP0 = Math.sin(p0);
    const cosP0 = Math.cos(p0);
    const A = view.camera;
    const R = view.radius;
    const unit = clamp(r / 420, 0.45, 1.8);
    const sprite = this.citySprite();
    ctx.save();
    const base = ctx.globalAlpha;
    ctx.globalCompositeOperation = "lighter";
    for (const [lo, la, wgt] of CITY_LIGHTS) {
      const p = la * rad;
      const dl = (lo - lon0) * rad;
      const nx = Math.cos(p) * Math.sin(dl);
      const ny = cosP0 * Math.sin(p) - sinP0 * Math.cos(p) * Math.cos(dl);
      const nz = sinP0 * Math.sin(p) + cosP0 * Math.cos(p) * Math.cos(dl);
      if (nz <= R / (R + A) + 0.02) continue;
      const light = nx * sun.sx + ny * sun.sy + nz * sun.sz;
      const dark = smooth(0.02, -0.2, light);
      if (dark <= 0.01) continue;
      const k = (R * A) / (R + A - R * nz);
      const x = cx + nx * k;
      const y = cy - ny * k;
      const facing = smooth(0.05, 0.4, nz); // fades out towards the limb
      const size = (0.7 + wgt * 0.45) * unit;
      ctx.globalAlpha = base * Math.min(1, 0.35 + wgt * 0.12) * dark * facing;
      ctx.drawImage(sprite, x - size * 3, y - size * 3, size * 6, size * 6);
    }
    ctx.restore();
  }
}
