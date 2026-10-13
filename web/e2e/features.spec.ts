import { expect, test } from "@playwright/test";
import { aKnownType, anAirlineCode, openFilters, openMap, visibleTypes } from "./helpers";

const visibleCallsigns = (page: import("@playwright/test").Page) =>
  page.evaluate(() => (window as any).__flights.layer.visiblePlanes().map((p: any) => p.callsign as string));

test("a callsign prefix hides every other aircraft, shows a chip and survives a reload", async ({ page }) => {
  await openMap(page, "c=50,10&z=5");
  const code = await anAirlineCode(page);
  const prefix = code.slice(0, 2);
  await openFilters(page);
  await page.getByLabel("Callsign starts with").fill(prefix.toLowerCase());
  await expect(page).toHaveURL(new RegExp(`cs=${prefix}`));
  await expect(page.getByTestId("chip-callsign")).toContainText(prefix);
  await expect(page.getByRole("button", { name: /^Filters, 1 active/ })).toBeVisible();
  await expect
    .poll(async () => {
      const all = await visibleCallsigns(page);
      return all.length > 0 && all.every((c) => c.startsWith(prefix));
    })
    .toBe(true);

  await page.reload();
  await page.waitForFunction(() => (window as any).__flights?.store.size > 5);
  await expect(page.getByTestId("chip-callsign")).toBeVisible();
  const after = await visibleCallsigns(page);
  expect(after.length).toBeGreaterThan(0);
  expect(after.every((c) => c.startsWith(prefix))).toBe(true);

  await page.getByRole("button", { name: /Remove the callsign filter/ }).click();
  await expect(page).not.toHaveURL(/cs=/);
  await expect.poll(async () => new Set((await visibleCallsigns(page)).map((c) => c.slice(0, 2))).size).toBeGreaterThan(3);
});

test("an aircraft type filter keeps only that type, also on a thinned world view", async ({ page }) => {
  await openMap(page, "c=50,10&z=5");
  const type = await aKnownType(page);
  await openFilters(page);
  const input = page.getByLabel("Aircraft type");
  await input.fill(type);
  await input.press("Enter");
  await expect(page).toHaveURL(new RegExp(`ty=${type}`));
  await expect(page.getByTestId("chip-types")).toContainText(type);
  await expect
    .poll(async () => {
      const types = await visibleTypes(page);
      return types.length > 0 && types.every((t) => t === type);
    })
    .toBe(true);

  // zoomed far out the server thins the picture; the filter must still leave matching aircraft
  await page.evaluate(() => (window as any).__flights.map.jumpTo({ center: [10, 30], zoom: 2.6 }));
  await expect
    .poll(async () => {
      const types = await visibleTypes(page);
      return types.length > 3 && types.every((t) => t === type);
    })
    .toBe(true);

  await page.getByRole("button", { name: "Remove the aircraft type filter" }).click();
  await expect(page).not.toHaveURL(/ty=/);
});

test("type suggestions come from the server and a wildcard matches a family", async ({ page }) => {
  await openMap(page, "c=50,10&z=5");
  await openFilters(page);
  const input = page.getByLabel("Aircraft type");
  await input.fill("boeing 737");
  await expect(page.locator("#type-suggestions option").first()).toHaveAttribute("value", /^B7/);
  await input.fill("A32*");
  await input.press("Enter");
  await expect(page).toHaveURL(/ty=A32\*|ty=A32%2A/);
  await expect
    .poll(async () => {
      const types = await visibleTypes(page);
      return types.length > 0 && types.every((t) => t.startsWith("A32"));
    })
    .toBe(true);
});

test("recent tracks are drawn from the server's own trails, only when zoomed in, and can be turned off", async ({ page }) => {
  const upstream: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("http://127.0.0.1")) upstream.push(r.url());
  });
  await openMap(page, "c=50,10&z=6.5");
  await openFilters(page);
  await page.getByRole("radio", { name: "30 min" }).check();
  await expect(page).toHaveURL(/tr=30/);
  await expect(page.getByTestId("chip-trails")).toContainText("30 min");
  // each aircraft needs two recorded fixes, which takes a few tile refreshes
  await expect.poll(() => page.evaluate(() => (window as any).__flights.recentTrails.featureCount), { timeout: 40_000 }).toBeGreaterThan(5);
  await expect(page.getByTestId("trails-hint")).toContainText(/\d+ tracks? in view/);
  expect(await page.evaluate(() => (window as any).__flights.map.getLayer("recent-trails-line") !== undefined)).toBe(true);

  // zoomed out there are too many aircraft for readable tracks
  await page.evaluate(() => (window as any).__flights.map.jumpTo({ zoom: 4 }));
  await expect(page.getByTestId("trails-hint")).toContainText("Zoom in");
  await expect(page.getByTestId("chip-trails")).toContainText("zoom in");
  await expect.poll(() => page.evaluate(() => (window as any).__flights.recentTrails.featureCount)).toBe(0);

  await page.getByRole("button", { name: "Turn recent tracks off" }).click();
  await expect(page).not.toHaveURL(/tr=/);
  expect(upstream).toEqual([]); // nothing but our own server
});

test("tracks follow the filters", async ({ page }) => {
  await openMap(page, "c=50,10&z=6.5&tr=30");
  await expect.poll(() => page.evaluate(() => (window as any).__flights.recentTrails.featureCount), { timeout: 40_000 }).toBeGreaterThan(5);
  const before = await page.evaluate(() => (window as any).__flights.recentTrails.featureCount);
  const type = await aKnownType(page);
  await openFilters(page);
  const input = page.getByLabel("Aircraft type");
  await input.fill(type);
  await input.press("Enter");
  await expect.poll(() => page.evaluate(() => (window as any).__flights.recentTrails.featureCount), { timeout: 30_000 }).toBeLessThan(before);
});

test("the airport view lists runways, frequencies, links and nearby traffic", async ({ page }) => {
  await openMap(page, "c=54.38,18.47&z=8"); // Gdansk: no synthetic ground traffic that could take the click
  await page.waitForFunction(() => {
    const m = (window as any).__flights.map;
    return !!m.getLayer("airports-large") && m.queryRenderedFeatures({ layers: ["airports-large"] }).length > 0;
  });
  const pt = await page.evaluate(() => (window as any).__flights.map.project([18.4662, 54.3776]));
  await page.mouse.click(pt.x, pt.y, { position: undefined });
  const card = page.getByTestId("airport-card");
  await expect(card).toBeVisible();
  const info = card.getByTestId("airport-info");
  await expect(info.getByRole("table", { name: "Runways" })).toBeVisible();
  expect(await info.getByRole("row").count()).toBeGreaterThanOrEqual(2); // header and one runway
  await expect(info.getByText("Tower").first()).toBeVisible();
  await expect(info.getByRole("link", { name: "Wikipedia" })).toHaveAttribute("href", /^https:\/\/[a-z.]*wikipedia\.org\//);
  await expect(info.getByText(/OurAirports/)).toBeVisible();
  await expect(card.getByTestId("airport-summary")).toContainText(/arriving .* on the ground/);
  await expect(card.getByText(/not a flight schedule/)).toBeVisible();
});

test("clicking an aircraft in the airport list opens it", async ({ page }) => {
  await openMap(page, "c=50.03,8.57&z=9&a=EDDF");
  const card = page.getByTestId("airport-card");
  const first = card.locator("ul[data-group] button.plane").first();
  await expect(first).toBeVisible();
  await first.click();
  await expect(page.getByTestId("aircraft-panel")).toBeVisible();
  await expect(page).toHaveURL(/[?&]s=[0-9a-f]{6}/);
});
