import type { Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import { serverNow } from "../core/clock";
import { clamp, latToY, lonToX } from "../core/geo";
import type { Plane } from "../core/plane";
import type { AircraftStore } from "../core/store";
import { AircraftGl, STRIDE_FLOATS } from "./aircraftGl";
import { altitudeRgb, packRgba } from "./palette";
import { SPRITE, spriteFor } from "./sprites";

const TILE_SIZE = 512; // MapLibre world size at zoom 0
const LABEL_MIN_ZOOM = 8;
const MAX_LABELS = 250;

export interface LayerStats {
  total: number;
  visible: number;
  frameMs: number;
  fps: number;
}

export interface AircraftLayerOptions {
  map: MapLibreMap;
  store: AircraftStore;
  getSelected: () => number | null;
  /** Return false to hide an aircraft (filters). */
  accepts?: (p: Plane) => boolean;
  onSelect: (hex: number | null) => void;
}

export function baseSize(zoom: number): number {
  return clamp(6 + zoom * 2.2, 11, 34);
}

/** Draws every aircraft on a WebGL canvas above the basemap, dead-reckoned each frame. */
export class AircraftLayer {
  private gl: AircraftGl;
  private labels: HTMLCanvasElement;
  private labelCtx: CanvasRenderingContext2D;
  private instances = new Float32Array(4096 * STRIDE_FLOATS);
  private colors = new Uint32Array(this.instances.buffer);
  private hitX = new Float32Array(4096);
  private hitY = new Float32Array(4096);
  private hitPlane: Plane[] = [];
  private hitCount = 0;
  private moving = false;
  private raf = 0;
  private lastDraw = 0;
  private lastFrameTime = 0;
  private running = false;
  readonly stats: LayerStats = { total: 0, visible: 0, frameMs: 0, fps: 0 };

  constructor(private opts: AircraftLayerOptions) {
    const container = opts.map.getContainer();
    const canvas = document.createElement("canvas");
    canvas.className = "aircraft-canvas";
    const labels = document.createElement("canvas");
    labels.className = "label-canvas";
    for (const c of [canvas, labels]) {
      c.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
    }
    // above the basemap canvas, below the map controls
    const controls = container.querySelector(".maplibregl-control-container");
    container.insertBefore(canvas, controls);
    container.insertBefore(labels, controls);
    this.gl = new AircraftGl(canvas);
    this.labels = labels;
    const ctx = labels.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable");
    this.labelCtx = ctx;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const map = this.opts.map;
    map.on("render", this.onRender);
    map.on("movestart", this.onMoveStart);
    map.on("moveend", this.onMoveEnd);
    map.on("click", this.onClick);
    map.on("mousemove", this.onHover);
    this.raf = requestAnimationFrame(this.loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    const map = this.opts.map;
    map.off("render", this.onRender);
    map.off("movestart", this.onMoveStart);
    map.off("moveend", this.onMoveEnd);
    map.off("click", this.onClick);
    map.off("mousemove", this.onHover);
  }

  private onRender = (): void => this.draw();
  private onMoveStart = (): void => {
    this.moving = true;
  };
  private onMoveEnd = (): void => {
    this.moving = false;
  };

  private loop = (): void => {
    if (!this.running) return;
    if (!this.moving) this.draw();
    this.raf = requestAnimationFrame(this.loop);
  };

  /** Nearest visible aircraft within ``radius`` CSS pixels of a point, from the last drawn frame. */
  hitTest(x: number, y: number, radius = 16): Plane | null {
    let best: Plane | null = null;
    let bestD = radius * radius;
    for (let i = 0; i < this.hitCount; i++) {
      const dx = (this.hitX[i] as number) - x;
      const dy = (this.hitY[i] as number) - y;
      const d = dx * dx + dy * dy;
      if (d <= bestD) {
        bestD = d;
        best = this.hitPlane[i] as Plane;
      }
    }
    return best;
  }

  private onClick = (e: MapMouseEvent): void => {
    const p = this.hitTest(e.point.x, e.point.y, 18);
    this.opts.onSelect(p ? p.hex : null);
  };

  private onHover = (e: MapMouseEvent): void => {
    const hit = this.hitTest(e.point.x, e.point.y, 14);
    this.opts.map.getCanvas().style.cursor = hit ? "pointer" : "";
  };

  /** Test hook: redraw synchronously and count painted pixels. */
  coveredPixels(): number {
    this.draw();
    return this.gl.readCoveredPixels();
  }

  /** Screen position (CSS px) of an aircraft in the last frame, or null when off screen. */
  screenPosition(hex: number): { x: number; y: number } | null {
    for (let i = 0; i < this.hitCount; i++) {
      if ((this.hitPlane[i] as Plane).hex === hex) return { x: this.hitX[i] as number, y: this.hitY[i] as number };
    }
    return null;
  }

  private ensureCapacity(n: number): void {
    if (n * STRIDE_FLOATS <= this.instances.length) return;
    const cap = Math.max(n, (this.instances.length / STRIDE_FLOATS) * 2);
    this.instances = new Float32Array(cap * STRIDE_FLOATS);
    this.colors = new Uint32Array(this.instances.buffer);
    this.hitX = new Float32Array(cap);
    this.hitY = new Float32Array(cap);
  }

  draw(): void {
    const t0 = performance.now();
    const map = this.opts.map;
    const container = map.getContainer();
    const w = container.clientWidth;
    const h = container.clientHeight;
    this.gl.resize(w, h, window.devicePixelRatio || 1);
    const dpr = window.devicePixelRatio || 1;
    if (this.labels.width !== Math.round(w * dpr) || this.labels.height !== Math.round(h * dpr)) {
      this.labels.width = Math.round(w * dpr);
      this.labels.height = Math.round(h * dpr);
    }

    const now = serverNow();
    const frameDt = this.lastFrameTime ? clamp((t0 - this.lastFrameTime) / 1000, 0.001, 0.25) : 0.016;
    this.lastFrameTime = t0;
    const zoom = map.getZoom();
    const center = map.getCenter();
    const cmx = lonToX(center.lng);
    const cmy = latToY(center.lat);
    const worldSize = TILE_SIZE * 2 ** zoom;
    const size = baseSize(zoom);
    const selected = this.opts.getSelected();
    const accepts = this.opts.accepts;
    const planes = this.opts.store.planes;
    this.ensureCapacity(planes.length * 2 + 4);

    let n = 0;
    let hits = 0;
    this.hitPlane.length = 0;
    const margin = 24;
    const showLabels = zoom >= LABEL_MIN_ZOOM;
    const labelCandidates: Array<{ p: Plane; x: number; y: number; d: number }> = [];
    let selX = NaN;
    let selY = NaN;

    for (let i = 0; i < planes.length; i++) {
      const p = planes[i] as Plane;
      if (accepts && !accepts(p)) continue;
      const pos = p.positionAt(now);
      const py = (pos.y - cmy) * worldSize + h / 2;
      if (py < -margin || py > h + margin) continue;
      let dx = pos.x - cmx;
      dx -= Math.round(dx);
      const rot = (p.easeTrack(frameDt) * Math.PI) / 180;
      const sprite = spriteFor(p.category, p.onGround);
      const isSel = selected === p.hex;
      const [r, g, b] = altitudeRgb(p.altitudeAt(now), p.onGround);
      const color = packRgba(r, g, b, 255);
      const sz = size * sprite.scale * (isSel ? 1.35 : 1);
      for (let k = -1; k <= 1; k++) {
        const px = (dx + k) * worldSize + w / 2;
        if (px < -margin || px > w + margin) continue;
        const o = n * STRIDE_FLOATS;
        this.instances[o] = px;
        this.instances[o + 1] = py;
        this.instances[o + 2] = rot;
        this.instances[o + 3] = sz;
        this.colors[o + 4] = color;
        this.instances[o + 5] = sprite.cell;
        n++;
        this.hitX[hits] = px;
        this.hitY[hits] = py;
        this.hitPlane[hits] = p;
        hits++;
        if (isSel) {
          selX = px;
          selY = py;
        }
        if (showLabels && p.callsign) {
          labelCandidates.push({ p, x: px, y: py, d: (px - w / 2) ** 2 + (py - h / 2) ** 2 });
        }
      }
    }
    this.hitCount = hits;

    if (!Number.isNaN(selX)) {
      const o = n * STRIDE_FLOATS;
      this.instances[o] = selX;
      this.instances[o + 1] = selY;
      this.instances[o + 2] = 0;
      this.instances[o + 3] = Math.max(size * 2.1, 34);
      this.colors[o + 4] = packRgba(255, 255, 255, 255);
      this.instances[o + 5] = SPRITE.ring;
      n++;
    }
    this.gl.draw(this.instances, n);
    this.drawLabels(labelCandidates, dpr, w, h);

    this.stats.total = planes.length;
    this.stats.visible = hits;
    const dt = performance.now() - t0;
    this.stats.frameMs = this.stats.frameMs * 0.9 + dt * 0.1;
    this.stats.fps = this.stats.fps * 0.9 + (1 / frameDt) * 0.1;
    this.lastDraw = t0;
  }

  private drawLabels(
    cands: Array<{ p: Plane; x: number; y: number; d: number }>,
    dpr: number,
    w: number,
    h: number,
  ): void {
    const ctx = this.labelCtx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (cands.length === 0) return;
    cands.sort((a, b) => a.d - b.d);
    ctx.font = "600 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(8,12,24,0.92)";
    ctx.fillStyle = "#e6ebf5";
    const occupied = new Set<number>();
    const limit = Math.min(cands.length, MAX_LABELS);
    for (let i = 0; i < limit; i++) {
      const c = cands[i] as { p: Plane; x: number; y: number };
      const cellX = Math.floor((c.x + 14) / 64);
      const cellY = Math.floor(c.y / 14);
      const key = cellY * 4096 + cellX;
      if (occupied.has(key)) continue;
      occupied.add(key);
      ctx.strokeText(c.p.callsign, c.x + 14, c.y);
      ctx.fillText(c.p.callsign, c.x + 14, c.y);
    }
  }
}
