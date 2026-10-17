import { clamp } from "../core/geo";

/**
 * Altitude ramp (feet -> colour): one hue family, and the higher the aircraft, the lighter it gets, like a
 * contrail against the sky. Lightness carries the order, so it reads for colour-blind viewers and stays calm
 * with thousands of aircraft on screen. The accent colour is kept for the selected flight only.
 */
const STOPS: ReadonlyArray<readonly [number, readonly [number, number, number]]> = [
  [0, [67, 118, 214]],
  [5000, [84, 150, 228]],
  [15000, [124, 190, 238]],
  [28000, [168, 212, 242]],
  [40000, [222, 236, 248]],
];
const GROUND: readonly [number, number, number] = [107, 114, 128];
const UNKNOWN_ALT: readonly [number, number, number] = [150, 160, 172];

/** Aircraft whose area has not been refreshed for a while: a grey ghost at the last known position. */
export const GHOST_RGB: readonly [number, number, number] = [150, 158, 170];

/** The one accent of the interface: the selected flight, the primary action. */
export const ACCENT_RGB: readonly [number, number, number] = [255, 138, 61];

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
