export function fmtAlt(ft: number | null, onGround = false): string {
  if (onGround) return "On ground";
  if (ft === null) return "–";
  if (ft >= 18000) return `FL${Math.round(ft / 100).toString().padStart(3, "0")}`;
  return `${Math.round(ft).toLocaleString("en")} ft`;
}

export function fmtAltFull(ft: number | null, onGround = false): string {
  if (onGround) return "On ground";
  return ft === null ? "–" : `${Math.round(ft).toLocaleString("en")} ft`;
}

export function fmtSpeed(kt: number | null): string {
  return kt === null ? "–" : `${Math.round(kt)} kt`;
}

export function fmtVrate(fpm: number | null): string {
  if (fpm === null || Math.abs(fpm) < 64) return "level";
  return `${fpm > 0 ? "+" : "−"}${Math.abs(Math.round(fpm / 10) * 10).toLocaleString("en")} ft/min`;
}

export function fmtTrack(deg: number | null): string {
  return deg === null ? "–" : `${Math.round(deg).toString().padStart(3, "0")}°`;
}

export function fmtAge(s: number): string {
  if (s < 1.5) return "just now";
  if (s < 90) return `${Math.round(s)} s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Fraction of the origin-to-destination distance already flown (0..1). */
export function progressAlong(
  origin: { lat: number; lon: number },
  dest: { lat: number; lon: number },
  lat: number,
  lon: number,
): number {
  const done = haversineKm(origin.lat, origin.lon, lat, lon);
  const left = haversineKm(lat, lon, dest.lat, dest.lon);
  const total = done + left;
  return total <= 0 ? 0 : Math.max(0, Math.min(1, done / total));
}

/** Squawk codes are four octal digits; the feed carries them as a number, so restore leading zeros. */
export function fmtSquawk(squawk: number | null): string {
  return squawk === null ? "–" : squawk.toString().padStart(4, "0");
}

export function squawkMeaning(squawk: number | null): string | null {
  switch (squawk) {
    case 7500:
      return "Hijack";
    case 7600:
      return "Radio failure";
    case 7700:
      return "General emergency";
    default:
      return null;
  }
}
