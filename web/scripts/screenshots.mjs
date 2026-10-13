// Regenerates docs/screenshots from a running demo server (synthetic traffic).
// Usage: DEMO_MODE=1 STATIC_DIR=../web/dist python -m flightmap   (in server/, PORT=9160), then
//        GPU=1 node scripts/screenshots.mjs http://127.0.0.1:9160
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://127.0.0.1:9160";
const out = new URL("../../docs/screenshots/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const args = process.env.GPU
  ? ["--ignore-gpu-blocklist", "--use-gl=angle", "--use-angle=gl"]
  : ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
const browser = await chromium.launch({ args });

async function ready(page, min = 150) {
  await page.waitForFunction((n) => window.__flights?.store.size > n, min, { timeout: 90000 });
  await page.waitForTimeout(2500);
}

async function pick(page, box) {
  return page.evaluate((b) => {
    for (const p of window.__flights.store.planes) {
      if (p.onGround || !p.speedKt || p.speedKt < 380 || !p.callsign) continue;
      const s = window.__flights.layer.screenPosition(p.hex);
      if (s && s.x > b.x0 && s.x < b.x1 && s.y > b.y0 && s.y < b.y1) return { hex: p.hex, ...s };
    }
    return null;
  }, box);
}

// desktop
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${base}/?e2e=1&c=50,12&z=5.3`);
  await ready(page);
  await page.screenshot({ path: `${out}map-europe.png` });

  const t = await pick(page, { x0: 650, x1: 1100, y0: 250, y1: 650 });
  await page.mouse.click(t.x, t.y);
  await page.waitForTimeout(16000);
  await page.screenshot({ path: `${out}aircraft-panel.png` });
  await page.keyboard.press("Escape");

  await page.getByRole("combobox").fill("lot");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}search.png` });
  await page.getByRole("combobox").fill("");
  await page.getByRole("button", { name: "Filters" }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}filters.png` });
  await ctx.close();
}
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${base}/?e2e=1&a=EDDF&c=50.03,8.57&z=9.5`);
  await ready(page, 100);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${out}airport-card.png` });
  await page.evaluate(() => window.__flights.map.jumpTo({ center: [10, 25], zoom: 2 }));
  await page.waitForTimeout(40000);
  await page.keyboard.press("Escape");
  await page.screenshot({ path: `${out}world-thinned.png` });
  await ctx.close();
}
// phone
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`${base}/?e2e=1&c=50,10&z=6`);
  await ready(page, 80);
  await page.screenshot({ path: `${out}mobile-map.png` });
  const t = await pick(page, { x0: 40, x1: 350, y0: 110, y1: 330 });
  await page.mouse.click(t.x, t.y);
  await page.waitForTimeout(14000);
  await page.screenshot({ path: `${out}mobile-sheet.png` });
  const grab = page.getByRole("button", { name: /Expand panel|Collapse panel/ });
  await grab.focus();
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}mobile-sheet-full.png` });
  await ctx.close();
}
await browser.close();
console.log("done");
