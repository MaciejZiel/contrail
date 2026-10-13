/** Great-circle helpers for drawing routes and estimating arrival. */

const RAD = Math.PI / 180;

export type LonLat = [number, number];

/** Points along the great circle between two coordinates, split into segments at the antimeridian. */
export function greatCircle(lat1: number, lon1: number, lat2: number, lon2: number, steps = 64): LonLat[][] {
  const p1 = lat1 * RAD;
  const l1 = lon1 * RAD;
  const p2 = lat2 * RAD;
  const l2 = lon2 * RAD;
  const d = 2 * Math.asin(Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2));
  if (d < 1e-9) return [[[lon1, lat1]]];
  const segments: LonLat[][] = [];
  let current: LonLat[] = [];
  let prevLon = lon1;
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const a = Math.sin((1 - f) * d) / Math.sin(d);
    const b = Math.sin(f * d) / Math.sin(d);
    const x = a * Math.cos(p1) * Math.cos(l1) + b * Math.cos(p2) * Math.cos(l2);
    const y = a * Math.cos(p1) * Math.sin(l1) + b * Math.cos(p2) * Math.sin(l2);
    const z = a * Math.sin(p1) + b * Math.sin(p2);
    const lat = Math.atan2(z, Math.hypot(x, y)) / RAD;
    const lon = Math.atan2(y, x) / RAD;
    if (i > 0 && Math.abs(lon - prevLon) > 180) {
      segments.push(current);
      current = [];
    }
    current.push([lon, lat]);
    prevLon = lon;
  }
  segments.push(current);
  return segments;
}

export interface Eta {
  remainingKm: number;
  minutes: number;
  arrivalUtc: Date;
}

/** Straight-line estimate from remaining great-circle distance and the current ground speed. */
export function estimateArrival(remainingKm: number, groundSpeedKt: number | null, now: Date): Eta | null {
  if (groundSpeedKt === null || groundSpeedKt < 80) return null; // too slow to say anything useful
  const kmh = groundSpeedKt * 1.852;
  const minutes = (remainingKm / kmh) * 60;
  return { remainingKm, minutes, arrivalUtc: new Date(now.getTime() + minutes * 60_000) };
}

export function fmtDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

export function fmtDistance(km: number): string {
  return `${Math.round(km).toLocaleString("en")} km (${Math.round(km / 1.852).toLocaleString("en")} nm)`;
}

export function fmtUtc(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}
