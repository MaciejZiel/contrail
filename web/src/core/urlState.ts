import { clamp } from "./geo";

export interface ViewState {
  lat: number;
  lon: number;
  zoom: number;
  selected: string | null;
}

export const DEFAULT_VIEW: ViewState = { lat: 50.0, lon: 10.0, zoom: 5, selected: null };

const HEX = /^[0-9a-f]{6}$/;

export function parseUrlState(search: string): ViewState {
  const p = new URLSearchParams(search);
  const view = { ...DEFAULT_VIEW };
  const c = p.get("c")?.split(",").map(Number);
  if (c && c.length === 2 && c.every(Number.isFinite)) {
    view.lat = clamp(c[0] as number, -85, 85);
    view.lon = clamp(c[1] as number, -180, 180);
  }
  const z = Number(p.get("z"));
  if (p.has("z") && Number.isFinite(z)) view.zoom = clamp(z, 1, 17);
  const s = p.get("s")?.toLowerCase();
  if (s && HEX.test(s)) view.selected = s;
  return view;
}

export function serializeUrlState(v: ViewState): string {
  const p = new URLSearchParams();
  p.set("c", `${v.lat.toFixed(4)},${v.lon.toFixed(4)}`);
  p.set("z", v.zoom.toFixed(2));
  if (v.selected) p.set("s", v.selected);
  return p.toString();
}

/** Parameters that are not view state (kept when we rewrite the URL). */
export function preservedParams(search: string): URLSearchParams {
  const p = new URLSearchParams(search);
  for (const k of ["c", "z", "s"]) p.delete(k);
  return p;
}
