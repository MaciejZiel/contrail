import { expect, test } from "@playwright/test";

test("fits a phone viewport without horizontal scrolling", async ({ page }) => {
  await page.goto("/?e2e=1&bm=offline&c=50,10&z=5");
  await expect(page.locator(".chip")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.waitForFunction(() => (window as any).__flights?.store.size > 50);
  await page.screenshot({ path: "test-results/mobile.png" });
});
