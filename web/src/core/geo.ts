/** Web Mercator helpers in unit coordinates (x, y in 0..1) and dead reckoning. */

export const EARTH_RADIUS_M = 6378137;
export const KT_TO_MS = 0.514444;
const MAX_LAT = 85.0511287798;

export function lonToX(lon: number): number {
  return (lon + 180) / 360;
}

export function latToY(lat: number): number {
  const clamped = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const s = Math.sin((clamped * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

export function xToLon(x: number): number {
  return x * 360 - 180;
}

export function yToLat(y: number): number {
  const n = Math.PI - 2 * Math.PI * y;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

/**
 * Velocity in Mercator units per second for a ground speed (knots) and track (degrees).
 * Linear in Mercator space: accurate to metres over the few minutes we extrapolate.
 */
export function mercatorVelocity(
  lat: number,
  trackDeg: number,
  speedKt: number,
): { vx: number; vy: number } {
  const v = speedKt * KT_TO_MS;
  const k = 1 / (2 * Math.PI * EARTH_RADIUS_M * Math.cos((lat * Math.PI) / 180));
  const t = (trackDeg * Math.PI) / 180;
  return { vx: v * Math.sin(t) * k, vy: -v * Math.cos(t) * k };
}

/** Shortest signed difference from angle a to angle b, in degrees (-180, 180]. */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
