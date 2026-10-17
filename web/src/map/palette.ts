import { clamp } from "../core/geo";
import type { Theme } from "../core/theme";

type Rgb = readonly [number, number, number];
type Stops = ReadonlyArray<readonly [number, Rgb]>;

interface Ramp {
  stops: Stops;
  ground: Rgb;
  unknown: Rgb;
  /** Aircraft whose area has not been refreshed for a while: a grey ghost at the last known position. */
  ghost: Rgb;
  /** The one accent of the interface: the selected flight. */
  accent: Rgb;
  /** The halo that separates an aircraft from the map under it, and its labels. */
  outline: Rgb;
  labelText: string;
  labelHalo: string;
  /** Dark (or light) edge under the selected trail, and the colour of the dashed projections. */
  casing: string;
  trailLine: string;
  trailMuted: string;
}

/**
 * Altitude ramp (feet -> colour): one hue family. Lightness carries the order, so it reads for colour-blind viewers
 * and stays calm with thousands of aircraft on screen. On the dark map the higher the aircraft, the lighter it gets,
 * like a contrail against the sky; on the light map the order is mirrored (higher is deeper), so the aircraft keep
 * at least 3:1 against land and water. The accent colour is kept for the selected flight only.
 */
const RAMPS: Record<Theme, Ramp> = {
  dark: {
    stops: [
      [0, [67, 118, 214]],
      [5000, [84, 150, 228]],
      [15000, [124, 190, 238]],
      [28000, [168, 212, 242]],
      [40000, [222, 236, 248]],
    ],
    ground: [107, 114, 128],
    unknown: [150, 160, 172],
    ghost: [150, 158, 170],
    accent: [255, 138, 61],
    outline: [8, 10, 13],
    labelText: "#eceae6",
    labelHalo: "rgba(10,12,15,0.92)",
    casing: "#07080a",
    trailLine: "#eceae6",
    trailMuted: "#a4abb6",
  },
  light: {
    stops: [
      [0, [40, 100, 200]],
      [5000, [32, 82, 178]],
      [15000, [26, 62, 150]],
      [28000, [22, 44, 118]],
      [40000, [16, 26, 84]],
    ],
    ground: [104, 110, 122],
    unknown: [96, 106, 122],
    ghost: [108, 116, 128],
    accent: [200, 72, 0],
    outline: [255, 255, 255],
    labelText: "#1a1d22",
    labelHalo: "rgba(255,255,255,0.92)",
    casing: "#ffffff",
    trailLine: "#1a1d22",
    trailMuted: "#5d646f",
  },
};

/** The theme the map currently shows (the globe is always dark); set by the map controller. */
let current: Theme = "dark";
export function setPaletteTheme(theme: Theme): void {
  current = theme;
}
export function paletteTheme(): Theme {
  return current;
}
export function ramp(theme: Theme = current): Ramp {
  return RAMPS[theme];
}

export const GHOST_RGB: Rgb = RAMPS.dark.ghost;
export const ACCENT_RGB: Rgb = RAMPS.dark.accent;

export function altitudeRgb(altFt: number | null, onGround: boolean, theme: Theme = current): [number, number, number] {
  const r = RAMPS[theme];
  if (onGround) return [...r.ground];
  if (altFt === null) return [...r.unknown];
  const a = clamp(altFt, 0, 40000);
  const stops = r.stops;
  for (let i = 1; i < stops.length; i++) {
    const hi = stops[i]!;
    const lo = stops[i - 1]!;
    if (a <= hi[0]) {
      const t = (a - lo[0]) / (hi[0] - lo[0]);
      return [
        Math.round(lo[1][0] + (hi[1][0] - lo[1][0]) * t),
        Math.round(lo[1][1] + (hi[1][1] - lo[1][1]) * t),
        Math.round(lo[1][2] + (hi[1][2] - lo[1][2]) * t),
      ];
    }
  }
  return [...stops[stops.length - 1]![1]];
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
