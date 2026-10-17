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

/** Press the switch until it reads the wanted theme. */
async function choose(page: Page, name: "Light" | "Dark"): Promise<void> {
  if ((await toggle(page).getAttribute("title")) !== `Theme: ${name}`) await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("title", `Theme: ${name}`);
}

test("starts dark whatever the system says, with no automatic mode", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openMap(page);
  expect(await theme(page)).toBe("dark");
  await expect(toggle(page)).toHaveAttribute("title", "Theme: Dark");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.emulateMedia({ colorScheme: "light" });
  expect(await theme(page)).toBe("dark");
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

  // remembered across a reload
  await openMap(page);
  expect(await theme(page)).toBe("light");
  expect(await page.evaluate(() => localStorage.getItem("contrail.theme"))).toBe("light");

  await choose(page, "Dark");
  await expect.poll(() => theme(page)).toBe("dark");
  await expect.poll(() => bodyBg(page)).toBe(darkBody);
  await expect.poll(() => mapBg(page)).toBe(darkMap);
  expect(problems.filter((p) => !/planespotters|Failed to load resource/.test(p))).toEqual([]);
});

test("the globe sphere follows the light theme, in a dark sky with stars", async ({ page }) => {
  await openMap(page, "c=50,10&z=2");
  await choose(page, "Light");
  await expect.poll(() => theme(page)).toBe("light");
  const flatLight = await mapBg(page);
  await page.getByRole("button", { name: "Globe" }).click();
  await expect(page.getByRole("img", { name: /Altitude colour legend.*darker is higher/ })).toBeVisible();
  expect(await mapBg(page)).toBe(flatLight); // the sphere uses the light palette
  const space = await page.evaluate(() => getComputedStyle(document.querySelector(".maplibregl-map") as HTMLElement).backgroundColor);
  expect(space).toBe("rgb(5, 6, 8)"); // outer space stays dark, with stars
  await page.waitForTimeout(500);
  expect(await covered(page)).toBeGreaterThan(300);
  await page.screenshot({ path: "test-results/theme-globe.png" });
  await choose(page, "Dark");
  await page.getByRole("button", { name: "Map" }).click();
  await expect.poll(() => mapBg(page)).not.toBe(flatLight);
});

test("blocked storage does not break the page", async ({ page }) => {
  const problems = watchErrors(page);
  await page.addInitScript(() => {
    const boom = () => {
      throw new Error("storage blocked");
    };
    Object.defineProperty(window, "localStorage", { get: boom });
  });
  await openMap(page);
  expect(await theme(page)).toBe("dark");
  await choose(page, "Light");
  await expect.poll(() => theme(page)).toBe("light");
  expect(problems.filter((p) => !/planespotters|Failed to load resource/.test(p))).toEqual([]);
});
