import { expect, test } from "@playwright/test";
import { openMap } from "./helpers";

test("zooming out draws a thinned picture, zooming in restores full density", async ({ page }) => {
  await openMap(page, "c=45,10&z=8");
  const total = () => page.evaluate(() => (window as any).__flights.store.size as number);
  await expect.poll(total, { timeout: 20_000 }).toBeGreaterThan(30);
  const detailed = await total();

  await page.evaluate(() => (window as any).__flights.map.jumpTo({ center: [10, 40], zoom: 2.5 }));
  // the world view is thinned to about one aircraft per 36 px cell, however much traffic exists
  await expect.poll(() => page.evaluate(() => (window as any).__flights.layer.visiblePlanes().length), { timeout: 30_000 }).toBeGreaterThan(80);
  await page.waitForTimeout(4000);
  const visible = await page.evaluate(() => (window as any).__flights.layer.visiblePlanes().length);
  expect(visible).toBeLessThan(1500);
  const sizeWorld = await total();
  expect(sizeWorld).toBeLessThan(2000);

  await page.evaluate(() => (window as any).__flights.map.jumpTo({ center: [10, 45], zoom: 8 }));
  await expect.poll(total, { timeout: 20_000 }).toBeGreaterThanOrEqual(detailed * 0.7);
});
