import { clamp } from "../core/geo";

/** Altitude ramp (feet -> colour), tuned for contrast on the dark basemap. */
const STOPS: ReadonlyArray<readonly [number, readonly [number, number, number]]> = [
  [0, [249, 115, 22]],
  [5000, [250, 190, 40]],
  [15000, [132, 225, 90]],
  [28000, [34, 211, 238]],
  [40000, [167, 139, 250]],
];
const GROUND: readonly [number, number, number] = [148, 163, 184];
const UNKNOWN_ALT: readonly [number, number, number] = [203, 213, 225];

export function altitudeRgb(altFt: number | null, onGround: boolean): [number, number, number] {
  if (onGround) return [...GROUND];
  if (altFt === null) return [...UNKNOWN_ALT];
  const a = clamp(altFt, 0, 40000);
  for (let i = 1; i < STOPS.length; i++) {
    const hi = STOPS[i]!;
    const lo = STOPS[i - 1]!;
    if (a <= hi[0]) {
      const t = (a - lo[0]) / (hi[0] - lo[0]);
      return [
        Math.round(lo[1][0] + (hi[1][0] - lo[1][0]) * t),
        Math.round(lo[1][1] + (hi[1][1] - lo[1][1]) * t),
        Math.round(lo[1][2] + (hi[1][2] - lo[1][2]) * t),
      ];
    }
  }
  return [...STOPS[STOPS.length - 1]![1]];
}

/** Legend entries for the UI. */
export const LEGEND: ReadonlyArray<{ label: string; ft: number }> = [
  { label: "0", ft: 0 },
  { label: "5k", ft: 5000 },
  { label: "15k", ft: 15000 },
  { label: "28k", ft: 28000 },
  { label: "40k ft", ft: 40000 },
];

export function packRgba(r: number, g: number, b: number, a: number): number {
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}
