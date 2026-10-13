import { expect, test } from "@playwright/test";
import { openMap } from "./helpers";

for (const dpr of [1, 2]) {
  test.describe(`device pixel ratio ${dpr}`, () => {
    test.use({ deviceScaleFactor: dpr });

    test("canvas matches the device resolution and aircraft are visible", async ({ page }) => {
      await openMap(page);
      const info = await page.evaluate(() => {
        const c = document.querySelector<HTMLCanvasElement>(".aircraft-canvas")!;
        const r = c.getBoundingClientRect();
        return { w: c.width, h: c.height, cssW: r.width, cssH: r.height, dpr: window.devicePixelRatio };
      });
      expect(info.dpr).toBe(dpr);
      expect(info.w).toBe(Math.round(info.cssW * dpr));
      expect(info.h).toBe(Math.round(info.cssH * dpr));
      const covered = await page.evaluate(() => (window as any).__flights.layer.coveredPixels());
      // sprites are sized in CSS pixels, so painted area scales with dpr squared
      expect(covered).toBeGreaterThan(800 * dpr * dpr);
      await page.screenshot({ path: `test-results/dpr${dpr}.png` });
    });
  });
}
