/** Typed client for the server's single-aircraft endpoints. */

export interface AircraftInfo {
  hex: string;
  callsign: string;
  registration: string;
  type_code: string;
  type_name: string | null;
  airline: { code: string; name: string } | null;
  category: string;
  squawk: number | null;
  on_ground: boolean;
  military: boolean;
  emergency: boolean;
  lat: number;
  lon: number;
  altitude_ft: number | null;
  speed_kt: number | null;
  track: number | null;
  vertical_rate_fpm: number | null;
  position_time: number;
}

export interface AirportRef {
  name: string;
  icao: string;
  iata: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  elevation_ft: number | null;
}

export interface RouteInfo {
  origin: AirportRef;
  destination: AirportRef;
  stops: AirportRef[];
  flight_number: string;
  plausible: boolean;
  progress: number | null;
}

export interface Trail {
  t: number[];
  lat: number[];
  lon: number[];
  alt: Array<number | null>;
  gs: Array<number | null>;
  vr: Array<number | null>;
}

export type Loaded<T> = { state: "loading" } | { state: "ok"; value: T } | { state: "none"; reason: string } | { state: "error"; reason: string };

const base = (): string => new URL("./", document.baseURI).href;

async function getJson(path: string, signal: AbortSignal): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${base()}${path}`, { signal });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

interface Envelope {
  ok?: boolean;
  reason?: string;
}

export async function fetchAircraft(hex: string, signal: AbortSignal): Promise<Loaded<AircraftInfo>> {
  const { status, body } = await getJson(`api/v1/aircraft/${hex}`, signal);
  const env = (body ?? {}) as Envelope & { aircraft?: AircraftInfo };
  if (status === 404) return { state: "none", reason: env.reason ?? "not_tracked" };
  if (status !== 200 || !env.ok || !env.aircraft) return { state: "error", reason: `HTTP ${status}` };
  return { state: "ok", value: env.aircraft };
}

export async function fetchRoute(hex: string, signal: AbortSignal): Promise<Loaded<RouteInfo>> {
  const { status, body } = await getJson(`api/v1/aircraft/${hex}/route`, signal);
  const env = (body ?? {}) as Envelope & { route?: RouteInfo };
  if (status === 404) return { state: "none", reason: env.reason ?? "not_tracked" };
  if (status !== 200) return { state: "error", reason: `HTTP ${status}` };
  if (!env.ok || !env.route) {
    return env.reason === "unavailable" || env.reason === "busy"
      ? { state: "error", reason: env.reason }
      : { state: "none", reason: env.reason ?? "unknown_route" };
  }
  return { state: "ok", value: env.route };
}

export async function fetchTrail(hex: string, signal: AbortSignal): Promise<Loaded<Trail>> {
  const { status, body } = await getJson(`api/v1/aircraft/${hex}/trail`, signal);
  const env = (body ?? {}) as Envelope & Partial<Trail>;
  if (status !== 200 || !env.ok || !env.t) return { state: "error", reason: `HTTP ${status}` };
  return {
    state: "ok",
    value: { t: env.t, lat: env.lat ?? [], lon: env.lon ?? [], alt: env.alt ?? [], gs: env.gs ?? [], vr: env.vr ?? [] },
  };
}

export interface SearchAircraft {
  kind: "aircraft";
  hex: string;
  callsign: string;
  registration: string;
  type_code: string;
  airline: string | null;
  lat: number;
  lon: number;
  altitude_ft: number | null;
  on_ground: boolean;
}

export interface SearchAirport {
  kind: "airport";
  icao: string;
  iata: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
}

export interface SearchAirline {
  kind: "airline";
  code: string;
  name: string;
  aircraft: number;
}

export interface SearchResults {
  aircraft: SearchAircraft[];
  airports: SearchAirport[];
  airlines: SearchAirline[];
}

export async function searchAll(q: string, signal: AbortSignal): Promise<SearchResults> {
  const { status, body } = await getJson(`api/v1/search?q=${encodeURIComponent(q)}`, signal);
  if (status !== 200) throw new Error(`search failed (HTTP ${status})`);
  const r = (body ?? {}) as Partial<SearchResults>;
  return { aircraft: r.aircraft ?? [], airports: r.airports ?? [], airlines: r.airlines ?? [] };
}

export interface Runway {
  ends: [string, string];
  length_ft: number;
  surface: string;
  lighted: boolean;
}

export interface AirportMeta {
  /** "Large airport", "Medium airport" or "Small airport" (OurAirports classification). */
  type: string;
  scheduled_service: boolean;
  region: string;
  runways: Runway[];
  frequencies: Array<{ type: string; mhz: number }>;
  wikipedia: string;
  website: string;
}

export type AirportCounts = Record<"arriving" | "departing" | "ground" | "nearby", number>;

export interface AirportDetail {
  airport: SearchAirport & AirportMeta & { elevation_ft: number | null; kind: string };
  nearby: NearbyAircraft[];
  counts: AirportCounts;
  radius_nm: number;
}

export interface NearbyAircraft extends SearchAircraft {
  state: "ground" | "arriving" | "departing" | "nearby";
  distance_nm: number;
  vertical_rate_fpm: number | null;
  /** ICAO codes of the route, only when the server already knew it. */
  origin?: string;
  destination?: string;
}

export interface MetarData {
  observed_at: number;
  raw: string;
  temp_c: number | null;
  dewpoint_c: number | null;
  wind_dir: number | null;
  wind_variable: boolean;
  wind_kt: number | null;
  gust_kt: number | null;
  visibility_m: number | null;
  visibility_plus: boolean;
  qnh_hpa: number | null;
  clouds: Array<{ cover: string; base_ft: number | null }>;
  weather: string;
  flight_category: string;
}

export interface Weather {
  metar: Loaded<MetarData>;
  taf: Loaded<string>;
}

export async function fetchAirport(code: string, signal: AbortSignal): Promise<Loaded<AirportDetail>> {
  const { status, body } = await getJson(`api/v1/airports/${encodeURIComponent(code)}`, signal);
  if (status === 404) return { state: "none", reason: "unknown_airport" };
  const env = (body ?? {}) as Envelope & Partial<AirportDetail>;
  if (status !== 200 || !env.ok || !env.airport) return { state: "error", reason: `HTTP ${status}` };
  const empty: AirportCounts = { arriving: 0, departing: 0, ground: 0, nearby: 0 };
  return { state: "ok", value: { airport: env.airport, nearby: env.nearby ?? [], counts: env.counts ?? empty, radius_nm: env.radius_nm ?? 10 } };
}

function part<T>(raw: unknown): Loaded<T> {
  const p = (raw ?? {}) as { ok?: boolean; data?: T; reason?: string };
  if (p.ok && p.data !== undefined) return { state: "ok", value: p.data };
  return p.reason === "unavailable" || p.reason === "busy" ? { state: "error", reason: p.reason } : { state: "none", reason: p.reason ?? "no_report" };
}

export async function fetchWeather(code: string, signal: AbortSignal): Promise<Weather> {
  const { status, body } = await getJson(`api/v1/airports/${encodeURIComponent(code)}/weather`, signal);
  if (status !== 200) return { metar: { state: "error", reason: `HTTP ${status}` }, taf: { state: "error", reason: `HTTP ${status}` } };
  const env = (body ?? {}) as { metar?: unknown; taf?: unknown };
  return { metar: part<MetarData>(env.metar), taf: part<string>(env.taf) };
}

export async function fetchAirlineNames(codes: string[], signal: AbortSignal): Promise<Record<string, string>> {
  if (codes.length === 0) return {};
  const { status, body } = await getJson(`api/v1/airlines?codes=${codes.join(",")}`, signal);
  return status === 200 ? ((body ?? {}) as Record<string, string>) : {};
}

export type AirportRow = [icao: string, iata: string, name: string, lat: number, lon: number, kind: "L" | "M"];

export async function fetchAirportCatalog(signal: AbortSignal): Promise<AirportRow[]> {
  const res = await fetch(`${base()}api/v1/airports/catalog`, { signal });
  if (!res.ok) throw new Error(`catalog HTTP ${res.status}`);
  return (await res.json()) as AirportRow[];
}


export interface TypeSuggestion {
  code: string;
  name: string;
  /** Aircraft of this type tracked right now. */
  count: number;
}

export async function fetchTypeSuggestions(query: string, signal: AbortSignal): Promise<TypeSuggestion[]> {
  const { status, body } = await getJson(`api/v1/types${query ? `?q=${encodeURIComponent(query)}` : ""}`, signal);
  if (status !== 200) return [];
  return ((body ?? {}) as { types?: TypeSuggestion[] }).types ?? [];
}

/** ICAO24 (as numbers) of the tracked aircraft whose type matches, e.g. ["A32*", "B738"]. */
export async function fetchTypeHexes(types: string[], signal: AbortSignal): Promise<Set<number>> {
  const { status, body } = await getJson(`api/v1/type-hexes?ty=${encodeURIComponent(types.join(","))}`, signal);
  if (status !== 200) throw new Error(`type lookup failed (HTTP ${status})`);
  const hexes = ((body ?? {}) as { hexes?: string[] }).hexes ?? [];
  return new Set(hexes.map((h) => parseInt(h, 16)));
}

export interface RecentTrail {
  h: string;
  /** [lon, lat, altitude in hundreds of feet or null] */
  p: Array<[number, number, number | null]>;
}

export interface RecentTrails {
  total: number;
  trails: RecentTrail[];
}

export interface BoundsBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export async function fetchRecentTrails(box: BoundsBox, minutes: number, filterQuery: string, signal: AbortSignal): Promise<RecentTrails> {
  const q = `w=${box.west.toFixed(3)}&s=${box.south.toFixed(3)}&e=${box.east.toFixed(3)}&n=${box.north.toFixed(3)}&window=${minutes * 60}`;
  const { status, body } = await getJson(`api/v1/trails?${q}${filterQuery}`, signal);
  if (status !== 200) throw new Error(`trails failed (HTTP ${status})`);
  const b = (body ?? {}) as Partial<RecentTrails>;
  return { total: b.total ?? 0, trails: b.trails ?? [] };
}
