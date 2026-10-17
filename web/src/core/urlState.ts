import { ALT_LIMIT, parseCallsigns, DEFAULT_FILTERS, parseTypes, type Filters } from "./filters";
import { clamp } from "./geo";

export interface ViewState {
  lat: number;
  lon: number;
  zoom: number;
  selected: string | null;
  airport: string | null;
  filters: Filters;
  /** Minutes of recent track drawn behind every aircraft; 0 is off. */
  trails: TrailMinutes;
  /** Globe projection instead of the flat map. */
  globe: boolean;
}

export type TrailMinutes = 0 | 30 | 60;

export const DEFAULT_VIEW: ViewState = {
  lat: 50.0,
  lon: 10.0,
  zoom: 5,
  selected: null,
  airport: null,
  filters: DEFAULT_FILTERS,
  trails: 0,
  globe: false,
};

const HEX = /^[0-9a-f]{6}$/;
const AIRPORT = /^[A-Z0-9]{3,4}$/;
const AIRLINE = /^[A-Z]{3}$/;

export function parseUrlState(search: string): ViewState {
  const p = new URLSearchParams(search);
  const view = { ...DEFAULT_VIEW };
  const c = p.get("c")?.split(",").map(Number);
  if (c && c.length === 2 && c.every(Number.isFinite)) {
    view.lat = clamp(c[0] as number, -85, 85);
    view.lon = clamp(c[1] as number, -180, 180);
  }
  const z = Number(p.get("z"));
  if (p.has("z") && Number.isFinite(z)) view.zoom = clamp(z, 0.5, 17);
  const s = p.get("s")?.toLowerCase();
  if (s && HEX.test(s)) view.selected = s;
  const a = p.get("a")?.toUpperCase();
  if (a && AIRPORT.test(a) && !view.selected) view.airport = a;
  const alt = p.get("alt")?.split("-").map(Number);
  const filters = { ...DEFAULT_FILTERS };
  if (alt && alt.length === 2 && alt.every(Number.isFinite)) {
    filters.altMin = clamp(Math.min(alt[0] as number, alt[1] as number), 0, ALT_LIMIT);
    filters.altMax = clamp(Math.max(alt[0] as number, alt[1] as number), 0, ALT_LIMIT);
  }
  const air = p.get("air")?.toUpperCase();
  if (air && AIRLINE.test(air)) filters.airline = air;
  if (p.get("gnd") === "0") filters.hideGround = true;
  const cs = parseCallsigns(p.get("cs") ?? "");
  if (cs.length) filters.callsigns = cs;
  const ty = parseTypes(p.get("ty") ?? "");
  if (ty.length) filters.types = ty;
  view.filters = filters;
  const tr = Number(p.get("tr"));
  if (tr === 30 || tr === 60) view.trails = tr;
  if (p.get("g") === "1") view.globe = true;
  return view;
}

export function serializeUrlState(v: ViewState): string {
  const p = new URLSearchParams();
  p.set("c", `${v.lat.toFixed(4)},${v.lon.toFixed(4)}`);
  p.set("z", v.zoom.toFixed(2));
  if (v.selected) p.set("s", v.selected);
  else if (v.airport) p.set("a", v.airport);
  if (v.filters.altMin > 0 || v.filters.altMax < ALT_LIMIT) p.set("alt", `${v.filters.altMin}-${v.filters.altMax}`);
  if (v.filters.airline) p.set("air", v.filters.airline);
  if (v.filters.hideGround) p.set("gnd", "0");
  if (v.filters.callsigns.length) p.set("cs", v.filters.callsigns.join(","));
  if (v.filters.types.length) p.set("ty", v.filters.types.join(","));
  if (v.trails) p.set("tr", String(v.trails));
  if (v.globe) p.set("g", "1");
  return p.toString();
}

/** Parameters that are not view state (kept when we rewrite the URL). */
export function preservedParams(search: string): URLSearchParams {
  const p = new URLSearchParams(search);
  for (const k of ["c", "z", "s", "a", "alt", "air", "gnd", "cs", "ty", "tr", "g"]) p.delete(k);
  return p;
}
