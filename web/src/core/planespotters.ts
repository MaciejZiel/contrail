/**
 * Aircraft photos from the Planespotters public photo API.
 *
 * Their terms require that the visitor's browser calls the API and loads the image itself:
 * no server-side proxying, URLs used unchanged, the photographer credited in text next to the
 * image and the thumbnail linking back to the photo page. JSON may be cached for up to 24 hours.
 */

export interface Photo {
  thumbnail: string;
  width: number;
  height: number;
  link: string;
  photographer: string;
}

const API = "https://api.planespotters.net/pub/photos/hex/";
const TTL_MS = 24 * 3600 * 1000;
const memory = new Map<string, { at: number; photo: Photo | null }>();
const inflight = new Map<string, Promise<Photo | null>>();

/**
 * Planespotters answers some automated clients (for example browsers that identify as HeadlessChrome)
 * without CORS headers, which the browser reports as an error in the console for every request. Real
 * browsers are not affected. After the first such failure the lookups stop for the rest of the visit,
 * so a blocked environment sees one error, not six per aircraft, and the type photo takes over.
 */
let blockedByCors = false;

/** Test hook. */
export function resetPhotoClientForTests(): void {
  blockedByCors = false;
  memory.clear();
  inflight.clear();
}

interface ApiPhoto {
  thumbnail?: { src?: string; size?: { width?: number; height?: number } };
  thumbnail_large?: { src?: string; size?: { width?: number; height?: number } };
  link?: string;
  photographer?: string;
}

/** Only https URLs on Planespotters hosts are used for links and images, whatever the API returns. */
function trusted(url: string | undefined): url is string {
  try {
    const u = new URL(url ?? "");
    return u.protocol === "https:" && /(^|\.)(planespotters\.net|plnspttrs\.net)$/.test(u.hostname);
  } catch {
    return false;
  }
}

export function parsePhotoResponse(body: unknown): Photo | null {
  const doc = (body ?? {}) as { photos?: ApiPhoto[]; error?: string };
  const first = doc.photos?.[0];
  if (!first) return null;
  const thumb = first.thumbnail_large ?? first.thumbnail;
  if (!trusted(thumb?.src) || !trusted(first.link) || !first.photographer) return null;
  return {
    thumbnail: thumb.src as string,
    width: thumb.size?.width ?? 420,
    height: thumb.size?.height ?? 280,
    link: first.link as string,
    photographer: first.photographer,
  };
}

/** Remove cached lookups older than the 24 hour limit, so storage cannot fill up. */
function purgeExpired(): void {
  try {
    const now = Date.now();
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key?.startsWith("psp:")) continue;
      const at = (JSON.parse(localStorage.getItem(key) ?? "{}") as { at?: number }).at;
      if (typeof at !== "number" || now - at >= TTL_MS) localStorage.removeItem(key);
    }
  } catch {
    /* storage unavailable */
  }
}
purgeExpired();

function readStored(key: string): { at: number; photo: Photo | null } | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as { at: number; photo: Photo | null }) : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: { at: number; photo: Photo | null }): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: caching is only a convenience */
  }
}

/** Resolves to the best photo for an ICAO24 hex, or null when there is none. Throws on network errors. */
export async function fetchPhoto(hex: string, signal: AbortSignal): Promise<Photo | null> {
  return lookup(`psp:${hex.toLowerCase()}`, `${API}${hex.toUpperCase()}`, signal);
}

/** Same for a registration such as SP-LSD (used when the hex has no photo, e.g. after a re-registration). */
export async function fetchPhotoByReg(reg: string, signal: AbortSignal): Promise<Photo | null> {
  const clean = reg.trim().toUpperCase();
  if (!/^[A-Z0-9-]{2,10}$/.test(clean)) return null;
  return lookup(`psp:reg:${clean}`, `https://api.planespotters.net/pub/photos/reg/${clean}`, signal);
}

function lookup(key: string, url: string, signal: AbortSignal): Promise<Photo | null> {
  const pending = inflight.get(key);
  if (pending) return abortable(pending, signal); // the panel and its retries share one request per photo
  const p = lookupUncached(key, url).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return abortable(p, signal);
}

/** Resolve with the shared lookup, but let each caller walk away on its own abort signal. */
function abortable<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException("aborted", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

async function lookupUncached(key: string, url: string): Promise<Photo | null> {
  const now = Date.now();
  const cached = memory.get(key) ?? readStored(key);
  if (cached && now - cached.at < TTL_MS) {
    memory.set(key, cached);
    return cached.photo;
  }
  if (blockedByCors) throw new Error("photo lookups are blocked for this client");
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    // a TypeError that is not an abort is a network or CORS failure
    if (err instanceof TypeError) blockedByCors = true;
    throw err;
  }
  if (!res.ok) throw new Error(`photo API HTTP ${res.status}`);
  const photo = parsePhotoResponse(await res.json());
  const entry = { at: now, photo };
  memory.set(key, entry);
  writeStored(key, entry);
  return photo;
}
