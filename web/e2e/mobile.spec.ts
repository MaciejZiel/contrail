import { expect, test } from "@playwright/test";

async function openOnPhone(page: import("@playwright/test").Page): Promise<{ hex: number; x: number; y: number }> {
  await page.route("https://api.planespotters.net/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"photos":[]}' }));
  await page.goto("/?e2e=1&bm=offline&c=50,10&z=6");
  await page.waitForFunction(() => (window as any).__flights?.store.size > 30);
  const handle = await page.waitForFunction(() => {
    const f = (window as any).__flights;
    for (const p of f.store.planes) {
      if (p.onGround || !p.callsign) continue;
      const pos = f.layer.screenPosition(p.hex);
      if (pos && pos.x > 40 && pos.x < 350 && pos.y > 110 && pos.y < 330) return { hex: p.hex, ...pos };
    }
    return null;
  });
  return (await handle.jsonValue()) as { hex: number; x: number; y: number };
}

test("fits a phone viewport without horizontal scrolling", async ({ page }) => {
  await page.goto("/?e2e=1&bm=offline&c=50,10&z=5");
  await expect(page.locator(".chip")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.waitForFunction(() => (window as any).__flights?.store.size > 50);
  await page.screenshot({ path: "test-results/mobile.png" });
});

test("an aircraft opens a bottom sheet with snap points that can be expanded and dismissed", async ({ page }) => {
  const t = await openOnPhone(page);
  await page.mouse.click(t.x, t.y);
  const sheet = page.locator(".sheet");
  await expect(sheet).toBeVisible();
  const height = () => sheet.evaluate((el) => el.getBoundingClientRect().height);
  await expect.poll(height).toBeGreaterThan(300); // a real half-height sheet, not the 196 px peek
  const half = await height();

  // the handle is a button: keyboard users step through the snap points
  const grab = page.getByRole("button", { name: /Expand panel|Collapse panel/ });
  await grab.focus();
  await page.keyboard.press("ArrowUp");
  await expect.poll(height).toBeGreaterThan(half + 100);
  await expect(grab).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect.poll(height).toBeLessThan(205); // peek, after the snap animation has finished

  // the route and the live numbers are visible in the peek, the photo is not required to be
  await expect(page.getByTestId("aircraft-panel").getByRole("region", { name: "Route" })).toBeVisible();

  // dragging the handle down past the peek dismisses the sheet
  const box = (await grab.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 200, { steps: 8 });
  await page.mouse.up();
  await expect(sheet).toBeHidden();
  await expect(page).not.toHaveURL(/s=/);
});

test("the sheet does not trap the page: content scrolls only when expanded", async ({ page }) => {
  const t = await openOnPhone(page);
  await page.mouse.click(t.x, t.y);
  const grab = page.getByRole("button", { name: /Expand panel/ });
  await grab.focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  const scrollable = await page.getByTestId("aircraft-panel").evaluate((el) => el.scrollHeight > el.clientHeight);
  expect(scrollable).toBe(true);
  await page.screenshot({ path: "test-results/mobile-sheet-full.png" });
});

test.describe("on a 400 x 800 phone", () => {
  test.use({ viewport: { width: 400, height: 800 } });

  test("the half-open sheet shows callsign, route line and the photo without scrolling; the peek shows callsign and route", async ({ page }) => {
    const t = await openOnPhone(page);
    await page.mouse.click(t.x, t.y);
    const sheet = page.locator(".sheet");
    await expect(sheet).toBeVisible();
    const sheetBox = async () => (await sheet.boundingBox())!;
    await expect.poll(async () => (await sheetBox()).height).toBeGreaterThan(380); // half open, after the opening animation
    await expect.poll(async () => (await sheetBox()).height).toBeLessThan(450);

    const panel = page.getByTestId("aircraft-panel");
    const heading = panel.getByRole("heading", { level: 2 });
    const route = panel.getByRole("region", { name: "Route" });
    const photo = panel.locator("figure");
    for (const part of [heading, route, photo]) {
      await expect(part).toBeVisible();
      await expect(part).toBeInViewport({ ratio: 1 }); // fully on screen: no scrolling needed
    }
    // the photo is really there (an image or the illustration), has a sensible size and ends above the sheet's bottom edge
    const box = (await photo.boundingBox())!;
    expect(box.height).toBeGreaterThan(110);
    expect(box.y + box.height).toBeLessThanOrEqual((await sheetBox()).y + (await sheetBox()).height + 1);
    await expect(photo.locator("img, svg").first()).toBeVisible();
    await expect(panel.getByRole("region", { name: "Route" }).locator("strong").first()).toBeVisible();
    await page.screenshot({ path: "test-results/mobile-400x800-half.png" });

    // the peek keeps the callsign and the route line on screen
    const grab = page.getByRole("button", { name: /Expand panel|Collapse panel/ });
    await grab.focus();
    await page.keyboard.press("ArrowDown");
    await expect.poll(async () => (await sheetBox()).height).toBeLessThan(205);
    await expect(heading).toBeInViewport({ ratio: 1 });
    await expect(route).toBeInViewport({ ratio: 1 });
  });
});

test.describe("filters, tracks and airports on a 400 x 800 phone", () => {
  test.use({ viewport: { width: 400, height: 800 } });

  const open = async (page: import("@playwright/test").Page, query: string, min = 20) => {
    await page.goto(`/?e2e=1&bm=offline&${query}`);
    await page.waitForFunction((n) => (window as any).__flights?.store.size >= n, min);
  };
  const noSideScroll = async (page: import("@playwright/test").Page) =>
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

  test("the filter panel fits the screen, scrolls inside itself and every control can be used", async ({ page }) => {
    await open(page, "c=50,10&z=6.5");
    await page.getByRole("button", { name: /^Filters/ }).click();
    const panel = page.locator("#filter-panel");
    const box = (await panel.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(400);
    expect(box.y + box.height).toBeLessThanOrEqual(800);
    await noSideScroll(page);

    const code = await page.evaluate(() => (window as any).__flights.store.planes.find((p: any) => /^[A-Z]{3}\d/.test(p.callsign)).callsign.slice(0, 2) as string);
    const callsign = page.getByLabel("Callsign starts with");
    await callsign.scrollIntoViewIfNeeded();
    await callsign.fill(code);
    await expect(page).toHaveURL(new RegExp(`cs=${code}`));

    const radio = page.getByRole("radio", { name: "30 min" });
    await radio.scrollIntoViewIfNeeded();
    const rb = (await radio.locator("xpath=..").boundingBox())!;
    expect(rb.height).toBeGreaterThanOrEqual(44); // a comfortable touch target
    await radio.check();
    await expect(page).toHaveURL(/tr=30/);
    await expect(page.getByTestId("chip-callsign")).toBeVisible();
    await expect(page.getByTestId("chip-trails")).toBeVisible();
    await page.screenshot({ path: "test-results/mobile-filters.png" });
    await noSideScroll(page);
  });

  test("the chips wrap instead of overflowing", async ({ page }) => {
    await open(page, "c=50,10&z=5&cs=LO&ty=A32*,B738&tr=60&air=LOT", 0);
    await expect(page.getByTestId("chip-types")).toBeVisible();
    await noSideScroll(page);
    for (const id of ["chip-callsign", "chip-types", "chip-trails"]) {
      const b = (await page.getByTestId(id).boundingBox())!;
      expect(b.x + b.width).toBeLessThanOrEqual(400);
    }
  });

  test("the filter panel stays on screen when four chips wrap the top bar", async ({ page }) => {
    await open(page, "c=50,10&z=5&cs=LO&ty=A32*,B738,A21N&tr=60&air=LOT", 0);
    await expect(page.getByTestId("chip-airline")).toBeVisible();
    await expect(page.getByTestId("chip-trails")).toBeVisible();
    const chipTop = (await page.getByTestId("chip-trails").boundingBox())!;
    expect(chipTop.y).toBeGreaterThan(60); // the chips really did wrap onto further rows
    await page.getByRole("button", { name: /^Filters/ }).click();
    const panel = page.locator("#filter-panel");
    await expect(panel).toBeVisible();
    const box = (await panel.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(800 - 8);
    expect(await panel.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true); // it scrolls inside itself
    const last = page.getByRole("radio", { name: "60 min" });
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
  });

  test("tracks appear when zoomed in", async ({ page }) => {
    await open(page, "c=50,10&z=6.5&tr=30");
    await expect.poll(() => page.evaluate(() => (window as any).__flights.recentTrails.featureCount), { timeout: 40_000 }).toBeGreaterThan(5);
  });

  test("an airport with two unnamed runways lists both instead of failing on a duplicate key", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await open(page, "c=8.16,35.55&z=9&a=HAGR", 0);
    const card = page.getByTestId("airport-card");
    await expect(card).toBeVisible();
    const info = card.getByTestId("airport-info");
    await info.scrollIntoViewIfNeeded();
    await expect(info.getByRole("table", { name: "Runways" }).getByRole("row")).toHaveCount(3); // header and two runways
    expect(errors).toEqual([]);
  });

  test("the airport sheet shows runways, frequencies and traffic", async ({ page }) => {
    await open(page, "c=50.03,8.57&z=9&a=EDDF");
    const card = page.getByTestId("airport-card");
    await expect(card).toBeVisible();
    const info = card.getByTestId("airport-info");
    await info.scrollIntoViewIfNeeded();
    await expect(info.getByRole("table", { name: "Runways" })).toBeVisible();
    const t = (await info.getByRole("table", { name: "Runways" }).boundingBox())!;
    expect(t.x + t.width).toBeLessThanOrEqual(400);
    await card.getByTestId("airport-summary").scrollIntoViewIfNeeded();
    await expect(card.getByTestId("airport-summary")).toBeVisible();
    await noSideScroll(page);
    await page.screenshot({ path: "test-results/mobile-airport.png" });
  });
});
