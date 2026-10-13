/** How old data may get before it is dimmed and then hidden (the server drops tiles at the same age). */
export const limits = { dimAfterS: 600, hideAfterS: 900 };

/** Align with the server's `max_age_s`; keeps the defaults when the status cannot be read. */
export async function loadLimits(baseUrl: string, signal?: AbortSignal): Promise<void> {
  try {
    const res = await fetch(`${baseUrl}api/v1/status`, { signal });
    if (!res.ok) return;
    const max = ((await res.json()) as { max_age_s?: number }).max_age_s;
    if (typeof max === "number" && max >= 60) {
      limits.hideAfterS = max;
      limits.dimAfterS = Math.round(max * (2 / 3));
    }
  } catch {
    /* keep defaults */
  }
}

/** 1 = fresh, 0.35 = old (dimmed), 0 = too old to show. */
export function staleOpacity(ageS: number): number {
  if (ageS >= limits.hideAfterS) return 0;
  return ageS >= limits.dimAfterS ? 0.35 : 1;
}
