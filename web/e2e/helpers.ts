import type { Page } from "@playwright/test";

export const FLIGHTS = "window.__flights";

/** Open the app on the offline basemap with test hooks enabled. */
export async function openMap(page: Page, query = "c=50,10&z=5"): Promise<void> {
  await page.goto(`/?e2e=1&bm=offline&${query}`);
  await page.waitForFunction(() => {
    const f = (window as unknown as { __flights?: { store: { size: number } } }).__flights;
    return !!f && f.store.size > 50;
  });
}

/** Pick a moving, airborne aircraft that is currently visible; returns its hex and screen position. */
export async function pickVisibleMover(page: Page): Promise<{ hex: number; x: number; y: number }> {
  const handle = await page.waitForFunction(() => {
    const f = (window as unknown as { __flights: any }).__flights;
    for (const p of f.store.planes) {
      if (p.onGround || !p.speedKt || p.speedKt < 250 || !p.callsign) continue;
      const pos = f.layer.screenPosition(p.hex);
      if (pos && pos.x > 120 && pos.x < 1100 && pos.y > 120 && pos.y < 600) return { hex: p.hex, ...pos };
    }
    return null;
  });
  return (await handle.jsonValue()) as { hex: number; x: number; y: number };
}
