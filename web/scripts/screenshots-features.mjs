// Screenshots of recent tracks, the type filter and the airport view (synthetic demo traffic).
// Tracks need a few minutes of history: start the demo server with a short tile and trail interval and wait
//   DEMO_MODE=1 TILE_TTL_S=3 TRAIL_MIN_INTERVAL_S=3 PREFETCH_REGIONS=off STATIC_DIR=../web/dist python -m flightmap
// (in server/, PORT=9350), look at the map for about five minutes, then
//   GPU=1 node scripts/screenshots-features.mjs http://127.0.0.1:9350
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://127.0.0.1:9350";
const out = new URL("../../docs/screenshots/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const args = process.env.GPU
  ? ["--ignore-gpu-blocklist", "--use-gl=angle", "--use-angle=gl"]
  : ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
const browser = await chromium.launch({ args });

async function ready(page, min = 100) {
  await page.waitForFunction((n) => window.__flights?.store.size > n, min, { timeout: 90000 });
  await page.waitForTimeout(2500);
}

async function commonType(page) {
  return page.evaluate(async () => {
    const counts = {};
    for (const p of window.__flights.layer.visiblePlanes().slice(0, 80)) {
      const info = await (await fetch(`api/v1/aircraft/${p.id}`)).json();
      const t = info.aircraft?.type_code;
      if (t) counts[t] = (counts[t] ?? 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  });
}

{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${base}/?e2e=1&c=50,10&z=6.4&tr=60`);
  await ready(page, 200);
  await page.waitForFunction(() => window.__flights.recentTrails.featureCount > 100, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}recent-tracks.png` });

  const type = await commonType(page);
  await page.getByRole("button", { name: /^Filters/ }).click();
  await page.getByLabel("Aircraft type").fill(type);
  await page.getByLabel("Aircraft type").press("Enter");
  await page.getByLabel("Callsign starts with").fill("");
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${out}filters.png` });
  await ctx.close();
}
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto(`${base}/?e2e=1&a=EDDF&c=50.03,8.57&z=9.5`);
  await ready(page, 100);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${out}airport-card.png` });
  await page.getByTestId("airport-info").scrollIntoViewIfNeeded();
  await page.getByTestId("airport-card").evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}airport-info.png` });
  await ctx.close();
}
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`${base}/?e2e=1&c=50,10&z=6.4&tr=30`);
  await ready(page, 60);
  await page.getByRole("button", { name: /^Filters/ }).click();
  await page.getByLabel("Callsign starts with").fill("RYR");
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}mobile-filters.png` });
  await ctx.close();
}
await browser.close();
console.log("done");
