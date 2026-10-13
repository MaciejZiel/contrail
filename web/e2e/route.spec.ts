import { expect, test } from "@playwright/test";
import { openMap, pickVisibleMover } from "./helpers";

test("the selected flight shows origin, destination, the remaining route and an arrival estimate", async ({ page }) => {
  await page.route("https://api.planespotters.net/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"photos":[]}' }));
  await openMap(page, "c=50,10&z=5");
  const target = await pickVisibleMover(page);
  await page.mouse.click(target.x, target.y);
  const panel = page.getByTestId("aircraft-panel");
  await expect(panel.getByText("Remaining", { exact: true })).toBeVisible();
  await expect(panel.getByText("Flown", { exact: true })).toBeVisible();
  await expect(panel.locator(".eta dt")).toContainText("Arrival");
  await expect(panel.locator(".eta em")).toHaveText("estimate");
  await expect(panel.getByText(/in (\d+ h \d+|\d+) min · \d\d:\d\d UTC/)).toBeVisible();

  await expect(page.locator(".route-pin.origin")).toHaveCount(1);
  await expect(page.locator(".route-pin.destination")).toHaveCount(1);
  const drawn = () =>
    page.evaluate(() => {
      const m = (window as any).__flights.map;
      return m.getLayer("route-remaining") ? (m.getSource("route") as any)._data?.features?.length ?? m.querySourceFeatures("route").length : 0;
    });
  await expect.poll(drawn).toBeGreaterThan(0);

  // deselecting removes everything again
  await page.keyboard.press("Escape");
  await expect(page.locator(".route-pin")).toHaveCount(0);
});

test("a flight first seen far from its origin gets a dashed estimated segment, labelled as such", async ({ page }) => {
  await page.route("https://api.planespotters.net/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"photos":[]}' }));
  await openMap(page, "c=50,10&z=5");
  const target = await pickVisibleMover(page);
  await page.mouse.click(target.x, target.y);
  await expect(page.locator(".route-est-label, .route-pin.origin").first()).toBeVisible();
  // our own history only starts when we first saw it: either the flight is near its origin or the gap is labelled
  const labelled = await page.locator(".route-est-label").count();
  const info = await page.evaluate(async (hex) => {
    const r = await (await fetch(`api/v1/aircraft/${hex}/route`)).json();
    const t = await (await fetch(`api/v1/aircraft/${hex}/trail`)).json();
    return { origin: r.route.origin, lat: t.lat[0], lon: t.lon[0] };
  }, target.hex.toString(16).padStart(6, "0"));
  const km = Math.hypot((info.origin.lat - info.lat) * 111, (info.origin.lon - info.lon) * 111 * Math.cos((info.lat * Math.PI) / 180));
  expect(labelled > 0).toBe(km > 40);
});
