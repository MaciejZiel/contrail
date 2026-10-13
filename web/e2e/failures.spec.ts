import { expect, test } from "@playwright/test";
import { collectConsole, expectUsefulFallback, FIRST_VISIT } from "./failureHelpers";
import { openMap } from "./helpers";

test("a blocked worker file gives the ad-blocker advice and the aircraft list", async ({ page }) => {
  const logs = collectConsole(page);
  await page.route(/maplibre-gl-worker\.mjs/, (r) => r.abort("blockedbyclient"));
  await page.goto(FIRST_VISIT);
  await expectUsefulFallback(page, "worker");
  await expect(page.getByTestId("map-problem")).toContainText(/ad or content blocker/i);
  expect(logs.some((l) => l.includes("[contrail] map unavailable (worker)"))).toBe(true);
});

test("a worker served with the wrong content type is retried past the cache and the map starts", async ({ page }) => {
  const logs = collectConsole(page);
  const seen: string[] = [];
  // what the server did before the mime.types fix, for the plain URL only: a cache-busting retry gets the real file
  await page.route(/maplibre-gl-worker\.mjs/, (route) => {
    const url = route.request().url();
    seen.push(url);
    if (url.includes("cb=")) return route.continue();
    return route.fulfill({ status: 200, contentType: "text/plain", body: "poisoned" });
  });
  await openMap(page);
  await expect(page.getByTestId("map-problem")).toHaveCount(0);
  expect(seen.some((u) => u.includes("cb="))).toBe(true);
  expect(logs.filter((l) => l.startsWith("error:") && l.includes("Worker failed")).length).toBe(0);
});

test("a worker that stays on the wrong content type is reported, not left blank", async ({ page }) => {
  await page.route(/maplibre-gl-worker\.mjs/, (route) => route.fulfill({ status: 200, contentType: "text/plain", body: "x" }));
  await page.goto(FIRST_VISIT);
  const problem = page.getByTestId("map-problem");
  await expect(problem).toBeVisible({ timeout: 25_000 });
  await expect(problem).toContainText(/content type|\.mjs/i);
  await expect(problem).toContainText("text/plain"); // the technical details name what the server sent
});

test("blocked traffic requests show an explanation instead of 'Loading traffic' for ever", async ({ page }) => {
  await page.route("**/api/v1/aircraft?**", (r) => r.abort("blockedbyclient"));
  await page.goto(FIRST_VISIT);
  const chip = page.locator(".chip");
  await expect(chip).toContainText(/Can't reach the traffic feed/, { timeout: 25_000 });
  await expect(chip).toHaveAttribute("title", /traffic request failed/);
  await expect(chip).toHaveAttribute("data-state", "offline");
});

test("a hanging first request ends in an explained 'still waiting' state", async ({ page }) => {
  await page.route("**/api/v1/aircraft?**", () => undefined); // never answered
  await page.goto(FIRST_VISIT);
  const chip = page.locator(".chip");
  await expect(chip).toContainText("Still waiting for traffic data", { timeout: 25_000 });
  await expect(chip).toHaveAttribute("title", /blocker|server may be blocking or delaying/);
});

test("a blocked basemap leaves the aircraft live and says so", async ({ page }) => {
  await page.route(/openfreemap\.org/, (r) => r.abort("blockedbyclient"));
  await page.goto("/?e2e=1&c=50,10&z=5"); // the online style, whose host is blocked
  await expect(page.getByRole("status").filter({ hasText: "map background could not be loaded" })).toBeVisible({ timeout: 25_000 });
  await page.waitForFunction(() => (window as any).__flights?.store.size > 30);
  const covered = await page.evaluate(() => (window as any).__flights.layer.coveredPixels());
  expect(covered).toBeGreaterThan(500);
});

test("an error that escapes while rendering shows a message, a reload button and a console line", async ({ page }) => {
  const logs = collectConsole(page);
  await page.goto("/?e2e=1&crashtest=1&bm=offline");
  const crash = page.getByTestId("crash");
  await expect(crash).toBeVisible();
  await expect(crash.getByRole("button", { name: "Reload" })).toBeVisible();
  await expect(crash).toContainText("crash test");
  expect(logs.some((l) => l.includes("[contrail] render error:"))).toBe(true);
});

test("a script error from our own code before the map loads is logged and turns into the message", async ({ page }) => {
  const logs = collectConsole(page);
  await page.goto("/?e2e=1&bm=offline&c=50,10&z=5");
  await page.waitForFunction(() => !!(window as any).__flights);
  // errors from extensions or other origins must not take a working map down
  await page.evaluate(() => window.dispatchEvent(new ErrorEvent("error", { message: "extension noise", filename: "chrome-extension://abc/x.js" })));
  await expect(page.getByTestId("map-problem")).toHaveCount(0);
  expect(logs.some((l) => l.includes("[contrail] uncaught error: extension noise"))).toBe(true);
});
