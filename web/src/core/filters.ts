import type { Plane } from "./plane";

export interface Filters {
  altMin: number;
  altMax: number;
  airline: string | null;
  hideGround: boolean;
  /** Callsign prefixes, upper case, each up to 8 characters ("LO", "RYR1"); a plane matches any. */
  callsigns: string[];
  /** ICAO type codes; a trailing "*" matches a family ("A32*"). */
  types: string[];
}

export const ALT_LIMIT = 45000;

export const DEFAULT_FILTERS: Filters = { altMin: 0, altMax: ALT_LIMIT, airline: null, hideGround: false, callsigns: [], types: [] };

export const MAX_TYPES = 8;
export const MAX_CALLSIGNS = 8;

export function activeFilterCount(f: Filters): number {
  return (
    (f.altMin > 0 || f.altMax < ALT_LIMIT ? 1 : 0) +
    (f.airline ? 1 : 0) +
    (f.hideGround ? 1 : 0) +
    (f.callsigns.length ? 1 : 0) +
    (f.types.length ? 1 : 0)
  );
}

/** Callsign prefixes from free text such as "lo, RYR1 n12": comma or whitespace separated, upper case, no repeats. */
export function parseCallsigns(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toUpperCase().split(/[\s,;]+/)) {
    if (/^[A-Z0-9]{1,8}$/.test(raw) && !out.includes(raw)) out.push(raw);
  }
  return out.slice(0, MAX_CALLSIGNS);
}

/** Type codes from free text such as "a32*, B738 b789": upper case, valid shape, no repeats. */
export function parseTypes(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toUpperCase().split(/[\s,;]+/)) {
    if (/^[A-Z0-9-]{1,4}\*?$/.test(raw) && !out.includes(raw)) out.push(raw);
  }
  return out.slice(0, MAX_TYPES);
}

/**
 * Query string for the server. For aircraft tiles only the callsign and type parts matter (a thinned
 * world view is then thinned among matching aircraft); ``all`` adds altitude and ground traffic,
 * which the track endpoint applies too.
 */
export function serverFilterQuery(f: Filters, all = false): string {
  const q = new URLSearchParams();
  if (all) {
    if (f.altMin > 0 || f.altMax < ALT_LIMIT) q.set("alt", `${f.altMin}-${f.altMax}`);
    if (f.hideGround) q.set("gnd", "0");
  }
  if (f.callsigns.length) q.set("cs", f.callsigns.join(","));
  if (f.airline) q.set("air", f.airline);
  if (f.types.length) q.set("ty", f.types.join(","));
  const s = q.toString();
  return s ? `&${s}` : "";
}

/**
 * ``typeHexes`` holds the ICAO24 of every tracked aircraft of the wanted types (the map data does
 * not carry the type); null means it has not arrived yet, so a type filter shows nothing meanwhile.
 */
export function accepts(p: Plane, f: Filters, typeHexes: ReadonlySet<number> | null = null): boolean {
  if (f.hideGround && p.onGround) return false;
  if (f.airline && p.callsign.slice(0, 3) !== f.airline) return false;
  if (f.callsigns.length && !f.callsigns.some((c) => p.callsign.startsWith(c))) return false;
  if (f.types.length && !(typeHexes?.has(p.hex) ?? false)) return false;
  if (f.altMin > 0 || f.altMax < ALT_LIMIT) {
    const alt = p.onGround ? 0 : p.altFt;
    if (alt !== null) {
      if (alt < f.altMin) return false;
      if (f.altMax < ALT_LIMIT && alt > f.altMax) return false;
    }
  }
  return true;
}

/** Number of aircraft per airline designator among planes, most common first. */
export function airlineCounts(planes: readonly Plane[], limit = 12): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const p of planes) {
    const cs = p.callsign;
    if (cs.length >= 4 && /^[A-Z]{3}$/.test(cs.slice(0, 3)) && /\d/.test(cs[3] as string)) {
      const code = cs.slice(0, 3);
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}
