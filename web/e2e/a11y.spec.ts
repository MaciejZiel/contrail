import { expect, test } from "@playwright/test";
import { openMap } from "./helpers";

test("aircraft can be reached and opened with the keyboard alone", async ({ page }) => {
  await page.route("https://api.planespotters.net/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"photos":[]}' }));
  await openMap(page);
  const summary = page.getByText("Aircraft near the map centre (keyboard list)");
  await summary.focus();
  await expect(summary).toBeVisible(); // revealed on focus
  await page.keyboard.press("Enter");
  const first = page.locator(".viewlist button").first();
  await expect(first).toBeVisible();
  await first.focus();
  await page.keyboard.press("Enter");
  const panel = page.getByTestId("aircraft-panel");
  await expect(panel).toBeVisible();
  await expect(page.locator("h2:focus")).toHaveCount(1); // focus moved into the new panel
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(page.locator("canvas.maplibregl-canvas:focus")).toHaveCount(1); // and came back to the map
});

test("controls have accessible names and the page has landmarks", async ({ page }) => {
  await openMap(page);
  await expect(page.getByRole("combobox", { name: /Search flights/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Filters" })).toBeVisible();
  await expect(page.getByRole("application", { name: "Live aircraft map" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText(/Live|Loading|Data/);
  const unnamed = await page.evaluate(() =>
    [...document.querySelectorAll("button, input, select")].filter((el) => {
      const e = el as HTMLElement;
      if (e.closest(".viewlist")) return false;
      const name = e.getAttribute("aria-label") ?? e.getAttribute("title") ?? e.textContent?.trim() ?? "";
      const labelled = (e as HTMLInputElement).labels?.length ? true : false;
      return !name && !labelled;
    }).length,
  );
  expect(unnamed).toBe(0);
});

test("page has one h1 inside main, and search and filters come first in the tab order", async ({ page }) => {
  await openMap(page);
  await expect(page.locator("main h1")).toHaveCount(1);
  await expect(page.locator("main")).toHaveCount(1);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("combobox", { name: /Search flights/ })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Filters" })).toBeFocused();
  const small = await page.evaluate(() =>
    [...document.querySelectorAll(".maplibregl-ctrl-attrib a")].filter((a) => a.getBoundingClientRect().height > 0 && a.getBoundingClientRect().height < 24).length,
  );
  expect(small).toBe(0);
});

test("Escape closes the filter panel and returns focus to its button", async ({ page }) => {
  await openMap(page);
  const button = page.getByRole("button", { name: "Filters" });
  await button.click();
  await expect(page.locator("#filter-panel")).toBeVisible();
  await page.locator("#filter-panel input.text").first().focus();
  await page.keyboard.press("Escape");
  await expect(page.locator("#filter-panel")).toBeHidden();
  await expect(button).toBeFocused();
});
