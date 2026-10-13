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
    return env.reason === "unavailable"
      ? { state: "error", reason: "unavailable" }
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
