import { expect, test, type Page } from "@playwright/test";
import { openMap } from "./helpers";

const toggle = (page: Page) => page.getByRole("button", { name: /^Theme:/ });
const theme = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme);
const bodyBg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const mapBg = (page: Page) => page.evaluate(() => (window as any).__flights.map.getPaintProperty("background", "background-color") as string);
const covered = (page: Page) => page.evaluate(() => (window as any).__flights.layer.coveredPixels() as number);

function watchErrors(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
  page.on("pageerror", (e) => problems.push(e.message));
  return problems;
}

/** Press the switch until it reads the wanted preference (system, light, dark, system...). */
async function choose(page: Page, name: "System" | "Light" | "Dark"): Promise<void> {
  for (let i = 0; i < 3; i++) {
    if ((await toggle(page).getAttribute("title")) === `Theme: ${name}`) return;
    await toggle(page).click();
  }
  throw new Error(`could not select ${name}`);
}

test("follows the system setting by default", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openMap(page);
  expect(await theme(page)).toBe("light");
  await expect(toggle(page)).toHaveAttribute("title", "Theme: System");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => theme(page)).toBe("dark");
});

test("switching to light restyles the map without a reload, and the choice is remembered", async ({ page }) => {
  const problems = watchErrors(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await openMap(page);
  await page.evaluate(() => ((window as any).__marker = "same-page"));
  const darkBody = await bodyBg(page);
  const darkMap = await mapBg(page);
  expect(await covered(page)).toBeGreaterThan(1000);

  await choose(page, "Light");
  await expect.poll(() => theme(page)).toBe("light");
  expect(await bodyBg(page)).not.toBe(darkBody);
  await expect.poll(() => mapBg(page)).not.toBe(darkMap);
  await page.waitForTimeout(500);
  expect(await covered(page)).toBeGreaterThan(1000); // aircraft still drawn
  expect(await page.evaluate(() => (window as any).__marker)).toBe("same-page"); // no reload
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible();
  await page.screenshot({ path: "test-results/theme-light.png" });

  // remembered across a reload, even though the system says dark
  await openMap(page);
  expect(await theme(page)).toBe("light");
  expect(await page.evaluate(() => localStorage.getItem("contrail.theme"))).toBe("light");

  await choose(page, "Dark");
  await expect.poll(() => theme(page)).toBe("dark");
  await expect.poll(() => bodyBg(page)).toBe(darkBody);
  await expect.poll(() => mapBg(page)).toBe(darkMap);
  expect(problems.filter((p) => !/planespotters|Failed to load resource/.test(p))).toEqual([]);
});

test("the globe stays a dark sphere in the light theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openMap(page, "c=50,10&z=2");
  const flat = await mapBg(page);
  await page.getByRole("button", { name: "Globe" }).click();
  await expect.poll(() => mapBg(page)).not.toBe(flat);
  expect(await theme(page)).toBe("light"); // the interface stays light
  await expect(page.getByRole("img", { name: /Altitude colour legend.*lighter is higher/ })).toBeVisible();
  await page.waitForTimeout(500);
  expect(await covered(page)).toBeGreaterThan(300);
  await page.screenshot({ path: "test-results/theme-globe.png" });
  await page.getByRole("button", { name: "Map" }).click();
  await expect.poll(() => mapBg(page)).toBe(flat);
});

test("blocked storage does not break the page", async ({ page }) => {
  const problems = watchErrors(page);
  await page.addInitScript(() => {
    const boom = () => {
      throw new Error("storage blocked");
    };
    Object.defineProperty(window, "localStorage", { get: boom });
  });
  await page.emulateMedia({ colorScheme: "light" });
  await openMap(page);
  expect(await theme(page)).toBe("light");
  await choose(page, "Dark");
  await expect.poll(() => theme(page)).toBe("dark");
  expect(problems.filter((p) => !/planespotters|Failed to load resource/.test(p))).toEqual([]);
});
