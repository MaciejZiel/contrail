/** How old data may get before it is drawn as a grey ghost and then hidden (the server drops tiles at the same age). */
export const limits = { dimAfterS: 600, hideAfterS: 900 };

/** Align with the server's `max_age_s` and `ghost_age_s`; keeps the defaults when the status cannot be read. */
export async function loadLimits(baseUrl: string, signal?: AbortSignal): Promise<void> {
  try {
    const res = await fetch(`${baseUrl}api/v1/status`, { signal });
    if (!res.ok) return;
    const body = (await res.json()) as { max_age_s?: number; ghost_age_s?: number };
    const max = body.max_age_s;
    if (typeof max === "number" && max >= 60) {
      limits.dimAfterS = Math.round(max * (2 / 3));
      // older servers have no ghost window: they stop serving a tile at max_age_s
      const ghost = body.ghost_age_s;
      limits.hideAfterS = typeof ghost === "number" && ghost >= max ? ghost : max;
    }
  } catch {
    /* keep defaults */
  }
}

/** 1 = fresh, 0.5 = old (a grey ghost at its last known position), 0 = too old to show. */
export function staleOpacity(ageS: number): number {
  if (ageS >= limits.hideAfterS) return 0;
  return ageS >= limits.dimAfterS ? 0.5 : 1;
}
