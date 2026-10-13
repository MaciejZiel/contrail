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

interface ApiPhoto {
  thumbnail?: { src?: string; size?: { width?: number; height?: number } };
  thumbnail_large?: { src?: string; size?: { width?: number; height?: number } };
  link?: string;
  photographer?: string;
}

export function parsePhotoResponse(body: unknown): Photo | null {
  const doc = (body ?? {}) as { photos?: ApiPhoto[]; error?: string };
  const first = doc.photos?.[0];
  if (!first) return null;
  const thumb = first.thumbnail_large ?? first.thumbnail;
  if (!thumb?.src || !first.link || !first.photographer) return null;
  return {
    thumbnail: thumb.src,
    width: thumb.size?.width ?? 420,
    height: thumb.size?.height ?? 280,
    link: first.link,
    photographer: first.photographer,
  };
}

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
  const key = `psp:${hex.toLowerCase()}`;
  const now = Date.now();
  const cached = memory.get(key) ?? readStored(key);
  if (cached && now - cached.at < TTL_MS) {
    memory.set(key, cached);
    return cached.photo;
  }
  const res = await fetch(`${API}${hex.toUpperCase()}`, { signal });
  if (!res.ok) throw new Error(`photo API HTTP ${res.status}`);
  const photo = parsePhotoResponse(await res.json());
  const entry = { at: now, photo };
  memory.set(key, entry);
  writeStored(key, entry);
  return photo;
}
