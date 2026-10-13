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
  const half = await height();
  expect(half).toBeGreaterThan(300);

  // the handle is a button: keyboard users step through the snap points
  const grab = page.getByRole("button", { name: /Expand panel|Collapse panel/ });
  await grab.focus();
  await page.keyboard.press("ArrowUp");
  await expect.poll(height).toBeGreaterThan(half + 100);
  await expect(grab).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect.poll(height).toBeLessThan(half - 80); // peek

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
