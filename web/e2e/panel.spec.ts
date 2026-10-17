import { expect, test, type Page } from "@playwright/test";
import { openMap, pickVisibleMover } from "./helpers";

// 1x1 transparent PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const PHOTO_LINK = "https://www.planespotters.net/photo/000001/test-photo";

/** The Planespotters API is called by the browser itself, so it is stubbed at the network edge. */
async function stubPlanespotters(page: Page, mode: "ok" | "error" | "empty" = "ok"): Promise<string[]> {
  const apiCalls: string[] = [];
  await page.route("https://api.planespotters.net/**", async (route) => {
    apiCalls.push(route.request().url());
    if (mode === "error") return route.fulfill({ status: 500, body: "boom" });
    if (mode === "empty") {
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: '{"photos":[]}' });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        photos: [
          {
            id: "000001",
            thumbnail: { src: "https://t.plnspttrs.net/t.png", size: { width: 200, height: 133 } },
            thumbnail_large: { src: "https://t.plnspttrs.net/l.png", size: { width: 420, height: 280 } },
            link: PHOTO_LINK,
            photographer: "Thomas Noack",
          },
        ],
      }),
    });
  });
  await page.route("https://t.plnspttrs.net/**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: PNG }));
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
  const violations: string[] = [];
  page.on("console", (m) => {
    if (/content security policy/i.test(m.text())) violations.push(m.text());
  });
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
  await expect(panel.locator("img")).toHaveAttribute("src", "https://t.plnspttrs.net/l.png");
  expect(apiCalls[0]).toMatch(new RegExp(`/pub/photos/hex/${hex.toUpperCase()}$`));

  // history: the server records positions for viewed tiles; charts appear once there are two points
  await expect(panel.locator("svg[role=img]").first()).toBeVisible({ timeout: 25_000 });
  expect(violations).toEqual([]); // the CSP the server sends allows everything the app really loads
});

test("a failing photo service only removes the photo", async ({ page }) => {
  await stubPlanespotters(page, "error");
  await openMap(page, "c=50,10&z=7");
  await selectMover(page);
  const panel = page.getByTestId("aircraft-panel");
  await expect(panel.getByText(/Illustration/).or(panel.getByRole("img", { name: /Representative photo/ }))).toBeVisible(); // never an empty panel
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

async function selectByType(page: Page, wanted: (type: string) => boolean, manifest: object = {}): Promise<string> {
  const hex = await page.evaluate(async ({ src, manifest }) => {
    const test = new Function("t", "manifest", `return (${src})(t)`) as (t: string, m: object) => boolean;
    const f = (window as any).__flights;
    for (const p of f.store.planes.slice(0, 400)) {
      if (!p.callsign) continue;
      const info = (await (await fetch(`api/v1/aircraft/${p.id}`)).json()).aircraft;
      if (info && info.type_code && test(info.type_code, manifest)) {
        f.select(p.hex);
        return p.id as string;
      }
    }
    return null;
  }, { src: wanted.toString(), manifest });
  expect(hex).not.toBeNull();
  return hex as string;
}

test("without an airframe photo the panel shows a representative type photo with credit and licence", async ({ page }) => {
  await stubPlanespotters(page, "empty");
  await openMap(page, "c=50,10&z=6");
  const manifest = await (await page.request.get("/type-photos/manifest.json")).json();
  // only types that really are in the gallery: a type without a photo correctly shows the illustration
  await selectByType(page, (t) => t in manifest, manifest);
  const panel = page.getByTestId("aircraft-panel");
  await expect(panel.getByRole("img", { name: /Representative photo/ })).toBeVisible();
  const img = panel.locator("figure img");
  await expect(img).toHaveAttribute("src", /type-photos\/[A-Z0-9]+\.jpg$/);
  await expect(panel.locator("figure").getByRole("link", { name: "Wikimedia Commons" })).toHaveAttribute("href", /commons\.wikimedia\.org\/wiki\/File:/);
  const code = ((await img.getAttribute("src")) ?? "").match(/([A-Z0-9]+)\.jpg$/)![1]!;
  const entry = manifest[code];
  expect(entry.spdx).toMatch(/^(CC-BY-\d\.\d|CC0-1\.0|LicenseRef-Public-Domain)$/); // never SA or NC
  await expect(panel.locator("figcaption")).toContainText(entry.author.slice(0, 12));
  await expect(panel.locator("figcaption")).toContainText(entry.license);
});

test("an unknown type falls back to our own illustration", async ({ page }) => {
  await stubPlanespotters(page, "empty");
  // a type that is not in the gallery: serve an empty manifest, as if the type had no photo
  await page.route("**/type-photos/manifest.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await openMap(page, "c=50,10&z=6");
  await selectByType(page, (t) => t === "A21N" || t === "A320");
  const panel = page.getByTestId("aircraft-panel");
  await expect(panel.getByText("Illustration · Airliner")).toBeVisible();
  await expect(panel.getByRole("img", { name: "Illustration: Airliner" })).toBeVisible();
});

test("selecting an aircraft that the panel would cover pans it into view", async ({ page }) => {
  await stubPlanespotters(page);
  await openMap(page, "c=50,10&z=7");
  const handle = await page.waitForFunction(() => {
    const f = (window as any).__flights;
    for (const p of f.store.planes) {
      if (p.onGround || !p.callsign) continue;
      const pos = f.layer.screenPosition(p.hex);
      if (pos && pos.x > window.innerWidth - 330 && pos.x < window.innerWidth - 60 && pos.y > 150 && pos.y < 650) return { hex: p.hex, ...pos };
    }
    return null;
  });
  const target = (await handle.jsonValue()) as { hex: number; x: number; y: number };
  await page.mouse.click(target.x, target.y);
  await expect(page.getByTestId("aircraft-panel")).toBeVisible();
  const panelLeft = await page.locator(".side, .sheet").first().evaluate((el) => el.getBoundingClientRect().left);
  await expect
    .poll(async () => (await page.evaluate((h) => (window as any).__flights.layer.screenPosition(h), target.hex))?.x ?? 1e9)
    .toBeLessThan(panelLeft);
});

test("a failing identity lookup is retried and the panel recovers", async ({ page }) => {
  await stubPlanespotters(page, "empty");
  await openMap(page, "c=50,10&z=7");
  let failures = 0;
  // fault injection: the first two identity requests answer 503 "busy", then the real server answers
  await page.route(/\/api\/v1\/aircraft\/[0-9a-f]{6}$/, (route) => {
    if (failures < 2) {
      failures++;
      return route.fulfill({ status: 503, contentType: "application/json", body: '{"ok":false,"reason":"busy"}' });
    }
    return route.continue();
  });
  await selectMover(page);
  const panel = page.getByTestId("aircraft-panel");
  await expect(panel.getByText(/Details are temporarily unavailable, retrying/)).toBeVisible();
  await expect(panel.getByText("Registration")).toBeVisible();
  await expect(panel.locator(".details dd").first()).not.toHaveText("–", { timeout: 20_000 });
  await expect(panel.getByText(/Illustration/).or(panel.getByRole("img", { name: /Representative photo/ }))).toBeVisible();
  expect(failures).toBe(2);
});

test("a client that Planespotters blocks (no CORS headers) asks once and falls back quietly", async ({ page }) => {
  let calls = 0;
  await page.route("https://api.planespotters.net/**", (route) => {
    calls++;
    return route.abort("failed"); // what a CORS rejection looks like to the page
  });
  await openMap(page, "c=50,10&z=7");
  await selectMover(page);
  const panel = page.getByTestId("aircraft-panel");
  await expect(panel.getByText(/Illustration/).or(panel.getByRole("img", { name: /Representative photo/ }))).toBeVisible();
  await page.keyboard.press("Escape");
  await selectMover(page);
  await expect(panel.getByText(/Illustration/).or(panel.getByRole("img", { name: /Representative photo/ }))).toBeVisible();
  expect(calls).toBe(1); // one failed request in the whole visit, not several per aircraft
});

test("moving the pointer over a chart steps by whole minutes and never changes the card's size", async ({ page }) => {
  await stubPlanespotters(page);
  await openMap(page, "c=50,10&z=7");
  await selectMover(page);
  const charts = page.locator(".spark svg");
  await expect(charts.first()).toBeVisible({ timeout: 20_000 });
  const count = await charts.count();
  for (let i = 0; i < count; i++) {
    const card = page.locator(".spark").nth(i);
    const before = await card.boundingBox();
    const box = (await charts.nth(i).boundingBox())!;
    const seen = new Set<string>();
    for (let k = 0; k <= 20; k++) {
      await page.mouse.move(box.x + (box.width * k) / 20, box.y + box.height / 2);
      const after = await card.boundingBox();
      expect(Math.round(after!.height)).toBe(Math.round(before!.height));
      seen.add((await card.locator(".head").innerText()).replace(/\s+/g, " "));
    }
    // every reading is a whole minute ("-N min" or "now")
    for (const text of seen) if (text.includes("·")) expect(text).toMatch(/· (−\d+ min|now)/);
  }
});
