import type { Map as MapLibreMap } from "maplibre-gl";
import { clamp } from "../core/geo";

const TILE_SIZE = 512;
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


/**
 * The backdrop of the globe: a fixed field of faint stars behind the basemap (the sky does not move when the globe
 * is turned), plus the geometry of the globe's outline shared with the aircraft layer (see AircraftLayer.drawGlobe).
 */
export class GlobeShading {
  private stars: HTMLCanvasElement;
  private starsCtx: CanvasRenderingContext2D;
  private starList = makeStars();
  private starsKey = "";
  private running = false;
  private light = false;

  constructor(private map: MapLibreMap) {
    const c = document.createElement("canvas");
    c.className = "globe-stars";
    c.setAttribute("aria-hidden", "true");
    c.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable");
    this.stars = c;
    this.starsCtx = ctx;
    map.getContainer().insertBefore(c, map.getContainer().firstChild); // behind the basemap
  }

  /** Stars belong to the dark sky only. */
  setTheme(theme: "light" | "dark"): void {
    this.light = theme === "light";
    this.starsKey = "";
    this.draw();
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

  private draw = (): void => {
    const c = this.map.getContainer();
    const w = c.clientWidth;
    const h = c.clientHeight;
    const dpr = Math.min(1.25, window.devicePixelRatio || 1);
    const zoom = this.map.getZoom();
    const lat = this.map.getCenter().lat;
    const near = zoom < 5.5;
    // the light sky has no stars but a soft shadow around the globe, so the pale sphere does not glare against it
    const key = this.light ? `${w}x${h}@${dpr}|L|${near}|${zoom.toFixed(3)}|${lat.toFixed(2)}` : `${w}x${h}@${dpr}|${near}`;
    if (key === this.starsKey) return;
    this.starsKey = key;
    const cv = this.stars;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    const ctx = this.starsCtx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!near) return;
    if (this.light) {
      const r = GlobeShading.view(zoom, lat, h).rim;
      if (r > 3 * Math.max(w, h)) return;
      const reach = r * 1.16;
      const g = ctx.createRadialGradient(w / 2, h / 2, r * 0.97, w / 2, h / 2, reach);
      g.addColorStop(0, "rgba(52,72,104,0.30)");
      g.addColorStop(0.35, "rgba(52,72,104,0.12)");
      g.addColorStop(1, "rgba(52,72,104,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      return;
    }
    for (const s of this.starList) {
      ctx.fillStyle = `rgba(${s.rgb},${s.a})`;
      ctx.beginPath();
      ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
  };
}
