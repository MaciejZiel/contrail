import { expect, test } from "@playwright/test";
import { openMap, pickVisibleMover } from "./helpers";

test("shows live aircraft with a freshness indicator", async ({ page }) => {
  await openMap(page);
  await expect(page.locator(".chip")).toContainText("Live");
  const covered = await page.evaluate(() => (window as any).__flights.layer.coveredPixels());
  expect(covered).toBeGreaterThan(1000);
  await page.screenshot({ path: "test-results/map.png" });
});

test("aircraft keep moving between updates without jumps", async ({ page }) => {
  await openMap(page, "c=50,10&z=7");
  const { hex } = await pickVisibleMover(page);
  const samples: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 12; i++) {
    const pos = await page.evaluate((h) => (window as any).__flights.layer.screenPosition(h), hex);
    if (pos) samples.push(pos);
    await page.waitForTimeout(250);
  }
  expect(samples.length).toBeGreaterThan(8);
  const total = Math.hypot(samples.at(-1)!.x - samples[0]!.x, samples.at(-1)!.y - samples[0]!.y);
  expect(total).toBeGreaterThan(1);
  for (let i = 1; i < samples.length; i++) {
    const step = Math.hypot(samples[i]!.x - samples[i - 1]!.x, samples[i]!.y - samples[i - 1]!.y);
    expect(step).toBeLessThan(12);
  }
});

test("aircraft stay on screen however old their data gets", async ({ page }) => {
  await openMap(page);
  // pretend the feed stalled: age every aircraft by ten minutes and check nothing is hidden
  const before = await page.evaluate(() => (window as any).__flights.layer.coveredPixels());
  await page.evaluate(() => {
    for (const p of (window as any).__flights.store.planes) p.fetchedAt -= 600;
  });
  const after = await page.evaluate(() => (window as any).__flights.layer.coveredPixels());
  expect(after).toBeGreaterThan(before * 0.8);
});

test("clicking an aircraft selects it and mirrors it in the URL", async ({ page }) => {
  await openMap(page, "c=50,10&z=7");
  const target = await pickVisibleMover(page);
  await page.mouse.click(target.x, target.y);
  const hex = target.hex.toString(16).padStart(6, "0");
  await expect(page).toHaveURL(new RegExp(`s=${hex}`));
  await expect(page.getByRole("complementary", { name: "Aircraft details" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("complementary", { name: "Aircraft details" })).toBeHidden();
  await expect(page).not.toHaveURL(/s=/);
});

test("restores the view and selection from the URL", async ({ page }) => {
  await openMap(page, "c=48.85,2.35&z=7.5&s=000001");
  const view = await page.evaluate(() => {
    const m = (window as any).__flights.map;
    return { lat: m.getCenter().lat, lon: m.getCenter().lng, zoom: m.getZoom() };
  });
  expect(view.lat).toBeCloseTo(48.85, 1);
  expect(view.lon).toBeCloseTo(2.35, 1);
  expect(view.zoom).toBeCloseTo(7.5, 1);
  await expect(page.getByRole("complementary", { name: "Aircraft details" })).toBeVisible();
});

test("polling stays frugal: a few requests while idle and one per pan", async ({ page }) => {
  const calls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/v1/aircraft")) calls.push(r.url());
  });
  await openMap(page, "c=50,10&z=6");
  await page.waitForTimeout(100);
  calls.length = 0;
  await page.waitForTimeout(14_000);
  expect(calls.length).toBeLessThanOrEqual(4);
  calls.length = 0;
  await page.evaluate(() => (window as any).__flights.map.jumpTo({ center: [14, 52] }));
  await page.waitForTimeout(1500);
  expect(calls.length).toBeLessThanOrEqual(2);
});
