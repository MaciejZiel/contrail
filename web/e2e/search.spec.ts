import { expect, test, type Page } from "@playwright/test";
import { openMap } from "./helpers";

async function anyCallsign(page: Page): Promise<string> {
  return page.evaluate(() => {
    const f = (window as any).__flights;
    return f.store.planes.find((p: any) => p.callsign.length >= 5)!.callsign as string;
  });
}

test("search finds a flight by callsign and selects it", async ({ page }) => {
  await openMap(page);
  const callsign = await anyCallsign(page);
  const box = page.getByRole("combobox", { name: /Search flights/ });
  await box.fill(callsign); // an exact match ranks first
  const option = page.getByRole("option", { name: new RegExp(callsign) }).first();
  await expect(option).toBeVisible();
  await box.press("ArrowDown");
  await box.press("Enter");
  await expect(page.getByTestId("aircraft-panel").getByRole("heading", { level: 2 })).toHaveText(callsign);
  await expect(page).toHaveURL(/[?&]s=[0-9a-f]{6}/);
});

test("search finds an aircraft by registration and by ICAO24", async ({ page }) => {
  await openMap(page);
  const { reg, hex } = await page.evaluate(async () => {
    const f = (window as any).__flights;
    const p = f.store.planes.find((x: any) => x.callsign);
    const info = await (await fetch(`api/v1/aircraft/${p.id}`)).json();
    return { reg: info.aircraft.registration as string, hex: p.id as string };
  });
  const box = page.getByRole("combobox", { name: /Search flights/ });
  await box.fill(reg);
  await expect(page.getByRole("option", { name: new RegExp(reg) }).first()).toBeVisible();
  await box.fill(hex);
  await expect(page.getByRole("option").first()).toBeVisible();
});

test("search finds airports and opens the airport card with weather and traffic", async ({ page }) => {
  await openMap(page);
  const box = page.getByRole("combobox", { name: /Search flights/ });
  await box.fill("warsaw");
  await page.getByRole("option", { name: /Warsaw Chopin/ }).click();
  const card = page.getByTestId("airport-card");
  await expect(card).toBeVisible();
  await expect(card.getByRole("heading", { level: 2 })).toHaveText("WAW");
  await expect(card.getByText("Weather (METAR)")).toBeVisible();
  await expect(card.locator("code").first()).toContainText("METAR EPWA");
  await expect(card.getByText("Traffic within 10 nm")).toBeVisible();
  await expect(card.getByText(/not a flight schedule/)).toBeVisible();
  await expect(page).toHaveURL(/[?&]a=EPWA/);
  await page.getByRole("button", { name: "Close airport details" }).click();
  await expect(card).toBeHidden();
  await expect(page).not.toHaveURL(/a=EPWA/);
});

test("search issues few requests and never loops", async ({ page }) => {
  await openMap(page);
  const searches: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/v1/search")) searches.push(r.url());
  });
  const box = page.getByRole("combobox", { name: /Search flights/ });
  await box.pressSequentially("lot45", { delay: 40 }); // typed faster than the debounce
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.waitForTimeout(3000); // idle: nothing may keep firing
  expect(searches.length).toBeLessThanOrEqual(2);
  const before = searches.length;
  await page.waitForTimeout(3000);
  expect(searches.length).toBe(before);
  await box.fill("a"); // below the minimum length: no request, list closed
  await expect(page.getByRole("listbox")).toBeHidden();
  expect(searches.length).toBe(before);
});

test("an airline result filters the map to that airline", async ({ page }) => {
  await openMap(page, "c=50,10&z=5");
  const code = await page.evaluate(() => {
    const f = (window as any).__flights;
    return f.store.planes.find((p: any) => /^[A-Z]{3}\d/.test(p.callsign)).callsign.slice(0, 3) as string;
  });
  const box = page.getByRole("combobox", { name: /Search flights/ });
  await box.fill(code);
  await page.getByRole("option").filter({ hasText: /in air|none loaded/ }).first().click();
  await expect(page.getByText(/^Only /)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`air=${code}`));
  // the layer applies the filter on its next update, so wait for it instead of reading once
  await expect
    .poll(async () => {
      const visible: string[] = await page.evaluate(() => (window as any).__flights.layer.visiblePlanes().map((p: any) => p.callsign.slice(0, 3)));
      return visible.length > 0 && visible.every((c) => c === code);
    })
    .toBe(true);
  await page.getByRole("button", { name: /Show all airlines/ }).click();
  await expect(page).not.toHaveURL(/air=/);
});
