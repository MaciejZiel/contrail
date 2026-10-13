import { expect, test } from "@playwright/test";
import { openMap } from "./helpers";

test("the altitude filter hides aircraft outside the range and is shareable", async ({ page }) => {
  await openMap(page, "c=50,10&z=5");
  await page.getByRole("button", { name: "Filters" }).click();
  await page.getByLabel("Maximum altitude").fill("12000");
  await expect(page).toHaveURL(/alt=0-12000/);
  // the next animation frame applies the filter
  await expect
    .poll(() =>
      page.evaluate(() => {
        const alts = (window as any).__flights.layer.visiblePlanes().map((p: any) => (p.onGround ? 0 : p.altFt));
        return alts.length > 0 ? Math.max(...alts.filter((a: number | null) => a !== null)) : null;
      }),
    )
    .toBeLessThanOrEqual(12000);
  await expect(page.getByRole("button", { name: "Filters, 1 active" })).toBeVisible();

  // a shared link restores the same filter
  await page.reload();
  await page.waitForFunction(() => (window as any).__flights?.store.size > 50);
  await expect(page.getByRole("button", { name: "Filters, 1 active" })).toBeVisible();
});

test("hiding ground traffic and resetting", async ({ page }) => {
  await openMap(page, "c=50,10&z=5");
  const grounded = () => page.evaluate(() => (window as any).__flights.layer.visiblePlanes().filter((p: any) => p.onGround).length);
  expect(await grounded()).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Filters" }).click();
  await page.getByLabel("Hide aircraft on the ground").check();
  await expect.poll(grounded).toBe(0);
  await page.getByRole("button", { name: "Reset" }).click();
  await expect.poll(grounded).toBeGreaterThan(0);
});

test("airports are drawn and clicking one opens its card", async ({ page }) => {
  // Gdansk has no synthetic ground traffic that could take the click
  await openMap(page, "c=54.38,18.47&z=8");
  await page.waitForFunction(() => {
    const m = (window as any).__flights.map;
    return !!m.getLayer("airports-large") && m.queryRenderedFeatures({ layers: ["airports-large"] }).length > 0;
  });
  const pt = await page.evaluate(() => (window as any).__flights.map.project([18.4662, 54.3776]));
  await page.mouse.click(pt.x, pt.y);
  await expect(page.getByTestId("airport-card")).toBeVisible();
  await expect(page.getByTestId("airport-card").getByRole("heading", { level: 2 })).toHaveText("GDN");
});
