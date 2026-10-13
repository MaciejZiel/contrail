import type { Page } from "@playwright/test";

export const FLIGHTS = "window.__flights";

/**
 * Open the app on the offline basemap with test hooks enabled. The synthetic traffic moves with
 * the wall clock, so small views ask for fewer aircraft than the default.
 */
export async function openMap(page: Page, query = "c=50,10&z=5", minAircraft = 50): Promise<void> {
  await page.goto(`/?e2e=1&bm=offline&${query}`);
  await page.waitForFunction((min) => {
    const f = (window as unknown as { __flights?: { store: { size: number } } }).__flights;
    return !!f && f.store.size > min;
  }, minAircraft);
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

/** Open the filter panel (it stays open until toggled). */
export async function openFilters(page: Page): Promise<void> {
  const button = page.getByRole("button", { name: /^Filters/ });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
}

/** The first three characters of a callsign that follows the airline pattern, e.g. "RYR". */
export async function anAirlineCode(page: Page): Promise<string> {
  return page.evaluate(() => {
    const f = (window as unknown as { __flights: any }).__flights;
    return f.store.planes.find((p: any) => /^[A-Z]{3}\d/.test(p.callsign)).callsign.slice(0, 3) as string;
  });
}

/** ICAO type of an aircraft that is being tracked, from the server's own detail endpoint. */
export async function aKnownType(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const f = (window as unknown as { __flights: any }).__flights;
    for (const p of f.store.planes.slice(0, 60)) {
      const info = await (await fetch(`api/v1/aircraft/${p.id}`)).json();
      if (info.aircraft?.type_code) return info.aircraft.type_code as string;
    }
    throw new Error("no aircraft with a known type");
  });
}

/** Types of the aircraft currently drawn, looked up on the server (it holds the type; the map does not). */
export async function visibleTypes(page: Page, limit = 25): Promise<string[]> {
  return page.evaluate(async (max) => {
    const f = (window as unknown as { __flights: any }).__flights;
    const planes = f.layer.visiblePlanes().slice(0, max);
    const out: string[] = [];
    for (const p of planes) {
      const info = await (await fetch(`api/v1/aircraft/${p.id}`)).json();
      out.push(info.aircraft?.type_code ?? "");
    }
    return out;
  }, limit);
}
