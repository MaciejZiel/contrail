import type { Feature, LineString } from "geojson";

/** How long a newly drawn track takes to appear. */
export const REVEAL_MS = 700;

type Coord = number[];
type Line<P> = Feature<LineString, P>;

export function easeOutCubic(t: number): number {
  const k = 1 - Math.min(1, Math.max(0, t));
  return 1 - k * k * k;
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function dist(a: Coord, b: Coord): number {
  return Math.hypot((b[0] as number) - (a[0] as number), (b[1] as number) - (a[1] as number));
}

function pathLength(c: Coord[]): number {
  let s = 0;
  for (let i = 1; i < c.length; i++) s += dist(c[i - 1] as Coord, c[i] as Coord);
  return s;
}

/** The first `fraction` (by length, 0..1) of a polyline; the cut point is interpolated. */
export function truncateLine(coords: Coord[], fraction: number): Coord[] {
  if (fraction >= 1 || coords.length < 2) return coords;
  if (fraction <= 0) return coords.slice(0, 1);
  let left = pathLength(coords) * fraction;
  const out: Coord[] = [coords[0] as Coord];
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1] as Coord;
    const b = coords[i] as Coord;
    const d = dist(a, b);
    if (d >= left) {
      const k = d === 0 ? 0 : left / d;
      out.push([(a[0] as number) + ((b[0] as number) - (a[0] as number)) * k, (a[1] as number) + ((b[1] as number) - (a[1] as number)) * k]);
      return out;
    }
    left -= d;
    out.push(b);
  }
  return out;
}

/**
 * Features that are consecutive pieces of one path (the altitude-coloured segments of a track):
 * keep the leading `fraction` of the whole path, cutting the last visible piece part way.
 */
export function revealSequence<P>(features: Array<Line<P>>, fraction: number): Array<Line<P>> {
  if (fraction >= 1) return features;
  const lens = features.map((f) => pathLength(f.geometry.coordinates));
  let left = lens.reduce((a, b) => a + b, 0) * Math.max(0, fraction);
  const out: Array<Line<P>> = [];
  for (let i = 0; i < features.length; i++) {
    const f = features[i] as Line<P>;
    const len = lens[i] as number;
    if (len <= left) {
      out.push(f);
      left -= len;
      continue;
    }
    if (left > 0) out.push({ ...f, geometry: { type: "LineString", coordinates: truncateLine(f.geometry.coordinates, left / len) } });
    break;
  }
  return out;
}

/** One eased 0..1 progress run on requestAnimationFrame; no frames are queued while idle. */
export class Reveal {
  private raf = 0;
  get running(): boolean {
    return this.raf !== 0;
  }
  start(onFrame: (fraction: number) => void, ms = REVEAL_MS): void {
    this.cancel();
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - t0) / ms));
      this.raf = t < 1 ? requestAnimationFrame(tick) : 0;
      onFrame(easeOutCubic(t));
    };
    this.raf = requestAnimationFrame(tick);
  }
  cancel(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}
