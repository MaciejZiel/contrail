import { expect, test } from "@playwright/test";
import { openMap, pickVisibleMover } from "./helpers";

const projection = (page: import("@playwright/test").Page) =>
  page.evaluate(() => (window as any).__flights.map.getProjection()?.type ?? "mercator");

test("the switch turns the map into a globe and back, and the choice is in the URL", async ({ page }) => {
  await openMap(page, "c=30,10&z=3");
  expect(await projection(page)).toBe("mercator");

  await page.getByRole("button", { name: "Globe" }).click();
  await expect(page.getByRole("button", { name: "Globe" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => projection(page)).toBe("globe");
  await expect(page).toHaveURL(/[?&]g=1/);
  const covered = await page.evaluate(() => (window as any).__flights.layer.coveredPixels());
  expect(covered).toBeGreaterThan(500);

  await page.getByRole("button", { name: "Map" }).click();
  await expect.poll(() => projection(page)).toBe("mercator");
  await expect(page).not.toHaveURL(/[?&]g=1/);
});

test("on the globe, aircraft behind the horizon are not drawn", async ({ page }) => {
  await openMap(page, "c=30,10&z=3");
  await page.getByRole("button", { name: "Globe" }).click();
  await expect.poll(() => projection(page)).toBe("globe");
  const visibleFrom = async (lon: number, lat: number) => {
    await page.evaluate(([lo, la]) => (window as any).__flights.map.jumpTo({ zoom: 1.2, center: [lo, la] }), [lon, lat]);
    await page.waitForTimeout(600);
    return page.evaluate(() => {
      const f = (window as any).__flights;
      f.layer.draw();
      return { total: f.layer.stats.total as number, visible: f.layer.stats.visible as number };
    });
  };
  const near = await visibleFrom(10, 30);
  const far = await visibleFrom(-170, -30); // the opposite side of the planet
  expect(near.total).toBeGreaterThan(50);
  expect(near.visible).toBeGreaterThan(0);
  // an aircraft is on one side or the other, never both: without hiding, both views would show all of them
  expect(near.visible + far.visible).toBeLessThanOrEqual(near.total);
});

test("an aircraft on the globe can be clicked and selected", async ({ page }) => {
  await openMap(page, "c=50,10&z=3&g=1");
  await expect.poll(() => projection(page)).toBe("globe");
  const target = await pickVisibleMover(page);
  await page.mouse.click(target.x, target.y);
  await expect(page.getByTestId("aircraft-panel")).toBeVisible();
  await expect(page).toHaveURL(/[?&]g=1/);
});

test("a link with g=1 opens the globe", async ({ page }) => {
  await openMap(page, "c=45,15&z=2&g=1");
  await expect.poll(() => projection(page)).toBe("globe");
  await expect(page.getByRole("button", { name: "Globe" })).toHaveAttribute("aria-pressed", "true");
});
