import { expect, test, type Page } from "@playwright/test";
import { openMap, pickVisibleMover } from "./helpers";

// 1x1 transparent PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const PHOTO_LINK = "https://www.planespotters.net/photo/000001/test-photo";

/** The Planespotters API is called by the browser itself, so it is stubbed at the network edge. */
async function stubPlanespotters(page: Page, mode: "ok" | "error" = "ok"): Promise<string[]> {
  const apiCalls: string[] = [];
  await page.route("https://api.planespotters.net/**", async (route) => {
    apiCalls.push(route.request().url());
    if (mode === "error") return route.fulfill({ status: 500, body: "boom" });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        photos: [
          {
            id: "000001",
            thumbnail: { src: "https://cdn.planespotters.net/t.png", size: { width: 200, height: 133 } },
            thumbnail_large: { src: "https://cdn.planespotters.net/l.png", size: { width: 420, height: 280 } },
            link: PHOTO_LINK,
            photographer: "Thomas Noack",
          },
        ],
      }),
    });
  });
  await page.route("https://cdn.planespotters.net/**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  return apiCalls;
}

async function selectMover(page: Page): Promise<string> {
  const target = await pickVisibleMover(page);
  await page.mouse.click(target.x, target.y);
  const panel = page.getByTestId("aircraft-panel");
  await expect(panel).toBeVisible();
  return target.hex.toString(16).padStart(6, "0");
}

test("the panel shows identity, route, live numbers, photo credit and history", async ({ page }) => {
  const apiCalls = await stubPlanespotters(page);
  await openMap(page, "c=50,10&z=7");
  const hex = await selectMover(page);
  const panel = page.getByTestId("aircraft-panel");

  await expect(panel.getByRole("heading", { level: 2 })).not.toHaveText("");
  await expect(panel.getByRole("region", { name: "Route" }).locator("strong").first()).toHaveText(/^[A-Z]{4}$/);
  await expect(panel.getByText("Altitude").first()).toBeVisible();
  await expect(panel.getByText(/^(FL\d{3}|[\d,]+ ft)$/).first()).toBeVisible();
  await expect(panel.getByText("ICAO24")).toBeVisible();
  await expect(panel.getByText(hex.toUpperCase(), { exact: true })).toBeVisible();

  // photo: credit in text next to the image, plain anchor back to the photo page, URLs untouched
  await expect(panel.getByText("Photo © Thomas Noack")).toBeVisible();
  const anchors = panel.locator(`a[href="${PHOTO_LINK}"]`);
  await expect(anchors).toHaveCount(2);
  for (const rel of await anchors.evaluateAll((els) => els.map((e) => e.getAttribute("rel") ?? ""))) {
    expect(rel).not.toContain("nofollow");
  }
  await expect(panel.locator("img")).toHaveAttribute("src", "https://cdn.planespotters.net/l.png");
  expect(apiCalls[0]).toMatch(new RegExp(`/pub/photos/hex/${hex.toUpperCase()}$`));

  // history: the server records positions for viewed tiles; charts appear once there are two points
  await expect(panel.locator("svg[role=img]").first()).toBeVisible({ timeout: 25_000 });
});

test("a failing photo service only removes the photo", async ({ page }) => {
  await stubPlanespotters(page, "error");
  await openMap(page, "c=50,10&z=7");
  await selectMover(page);
  const panel = page.getByTestId("aircraft-panel");
  await expect(panel.getByText("No photo available")).toBeVisible();
  await expect(panel.getByRole("region", { name: "Route" }).locator("strong").first()).toBeVisible();
  await expect(panel.getByText("Ground speed").first()).toBeVisible();
});

test("the trail of the selected aircraft is drawn on the map", async ({ page }) => {
  await stubPlanespotters(page);
  await openMap(page, "c=50,10&z=7");
  await selectMover(page);
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const m = (window as any).__flights.map;
          return m.getLayer("trail-line") ? m.queryRenderedFeatures({ layers: ["trail-line"] }).length : 0;
        }),
      { timeout: 25_000 },
    )
    .toBeGreaterThan(0);
});

test("a deep link without a view centres on the aircraft", async ({ page }) => {
  await stubPlanespotters(page);
  await openMap(page, "c=50,10&z=7");
  const target = await pickVisibleMover(page);
  const hex = target.hex.toString(16).padStart(6, "0");
  await page.goto(`/?e2e=1&bm=offline&s=${hex}`);
  await expect(page.getByTestId("aircraft-panel")).toBeVisible();
  const info = await page.evaluate(async (h) => (await fetch(`api/v1/aircraft/${h}`)).json(), hex);
  await expect
    .poll(() => page.evaluate(() => (window as any).__flights.map.getZoom()), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(7.9);
  const center = await page.evaluate(() => (window as any).__flights.map.getCenter());
  expect(Math.abs(center.lat - info.aircraft.lat)).toBeLessThan(6);
});
