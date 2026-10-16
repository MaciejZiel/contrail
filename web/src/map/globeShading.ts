import type { Map as MapLibreMap } from "maplibre-gl";
import { clamp } from "../core/geo";

const TILE_SIZE = 512;

/**
 * Soft shading for the globe, drawn on a canvas between the basemap and the aircraft: the sphere darkens
 * towards its edge, catches a faint light from the upper left, and has a thin even atmosphere ring. All of
 * it is low in contrast on purpose; it is there to give the disc volume, not to be looked at.
 * The geometry is the same pinhole model the aircraft layer uses (see AircraftLayer.drawGlobe).
 */
export class GlobeShading {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private key = "";
  private running = false;

  constructor(private map: MapLibreMap, before: Element | null) {
    const c = document.createElement("canvas");
    c.className = "globe-shading";
    c.setAttribute("aria-hidden", "true");
    c.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
    map.getContainer().insertBefore(c, before);
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable");
    this.canvas = c;
    this.ctx = ctx;
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
  }

  /** Radius in pixels of the globe's outline on screen, or null when the globe is not a disc any more. */
  static silhouetteRadius(zoom: number, lat: number, h: number): number {
    const radius = (TILE_SIZE * 2 ** zoom) / (2 * Math.PI) / Math.max(0.05, Math.cos((lat * Math.PI) / 180));
    const camera = 1.5 * h;
    const distance = radius + camera;
    const horizon = Math.acos(radius / distance);
    const rim = radius * Math.sin(horizon);
    const depth = distance - radius * Math.cos(horizon);
    return (rim * camera) / depth;
  }

  private draw = (): void => {
    const map = this.map;
    const container = map.getContainer();
    const w = container.clientWidth;
    const h = container.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    const zoom = map.getZoom();
    const lat = map.getCenter().lat;
    const key = `${w}x${h}@${dpr}|${zoom.toFixed(3)}|${lat.toFixed(2)}`;
    if (key === this.key) return;
    this.key = key;
    const cv = this.canvas;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const r = GlobeShading.silhouetteRadius(zoom, lat, h);
    // the effect fades out as the globe grows past the screen and flattens into the map
    const fade = clamp((5.5 - zoom) / 2, 0, 1);
    if (fade <= 0 || r > 3 * Math.max(w, h)) return;
    const cx = w / 2;
    const cy = h / 2;
    ctx.save();
    ctx.globalAlpha = fade;

    // atmosphere: a thin ring just outside the edge, even all the way round
    const ring = Math.max(10, r * 0.07);
    const outer = r + ring;
    const edge = (r * 0.985) / outer;
    const atmo = ctx.createRadialGradient(cx, cy, 0, cx, cy, outer);
    atmo.addColorStop(0, "rgba(96,140,200,0)");
    atmo.addColorStop(edge, "rgba(96,140,200,0)");
    atmo.addColorStop(Math.min(0.999, edge + 0.0001), "rgba(96,140,200,0.30)");
    atmo.addColorStop(Math.min(0.9995, edge + (1 - edge) * 0.4), "rgba(96,140,200,0.10)");
    atmo.addColorStop(1, "rgba(96,140,200,0)");
    ctx.fillStyle = atmo;
    ctx.beginPath();
    ctx.arc(cx, cy, r + ring, 0, Math.PI * 2);
    ctx.fill();

    // everything below is clipped to the disc
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    // limb darkening: the sphere falls away towards its edge
    const limb = ctx.createRadialGradient(cx, cy, r * 0.45, cx, cy, r);
    limb.addColorStop(0, "rgba(5,6,8,0)");
    limb.addColorStop(0.75, "rgba(5,6,8,0.2)");
    limb.addColorStop(1, "rgba(5,6,8,0.62)");
    ctx.fillStyle = limb;
    ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);

    // a faint light from the upper left, and a rim of it on that edge
    const lx = cx - r * 0.38;
    const ly = cy - r * 0.42;
    const sheen = ctx.createRadialGradient(lx, ly, 0, lx, ly, r * 1.05);
    sheen.addColorStop(0, "rgba(190,215,255,0.07)");
    sheen.addColorStop(0.55, "rgba(190,215,255,0.02)");
    sheen.addColorStop(1, "rgba(190,215,255,0)");
    ctx.fillStyle = sheen;
    ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);

    // a soft shadow on the lower right, opposite the light
    const sx = cx + r * 0.5;
    const sy = cy + r * 0.55;
    const shade = ctx.createRadialGradient(sx, sy, r * 0.2, sx, sy, r * 1.1);
    shade.addColorStop(0, "rgba(3,4,6,0.28)");
    shade.addColorStop(1, "rgba(3,4,6,0)");
    ctx.fillStyle = shade;
    ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    ctx.restore();
  };
}
