import { expect, test, type Page } from "@playwright/test";
import { openMap, pickVisibleMover } from "./helpers";

/** Records, per setData call on the selected-track source, the total drawn length in degrees. */
async function recordTrailCalls(page: Page): Promise<void> {
  await page.evaluate(() => {
    const m = (window as any).__flights.map;
    const src = m.getSource("trail");
    const calls: number[] = [];
    (window as any).__trailCalls = calls;
    const orig = src.setData.bind(src);
    src.setData = (d: any) => {
      let len = 0;
      for (const f of d.features ?? []) {
        const c = f.geometry.coordinates;
        for (let i = 1; i < c.length; i++) len += Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]);
      }
      calls.push(len);
      return orig(d);
    };
  });
}

const calls = (page: Page) => page.evaluate(() => [...((window as any).__trailCalls as number[])]);

async function selectAndWaitForTrail(page: Page): Promise<void> {
  await openMap(page, "c=50,10&z=7");
  await recordTrailCalls(page);
  const target = await pickVisibleMover(page);
  await page.mouse.click(target.x, target.y);
  await expect(page.getByTestId("aircraft-panel")).toBeVisible();
  // the demo traffic needs a while to have a recorded track
  await expect.poll(async () => (await calls(page)).some((n) => n > 0), { timeout: 40_000 }).toBe(true);
}

test("a selected aircraft's track is revealed progressively, then holds steady", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  await selectAndWaitForTrail(page);
  await page.waitForTimeout(1200); // 700 ms reveal plus margin
  const done = await calls(page);
  const first = done.findIndex((n) => n > 0);
  const run = done.slice(first);
  // grows monotonically over several frames up to the full track
  expect(run.length).toBeGreaterThan(2);
  expect(run.every((n, i) => i === 0 || n >= (run[i - 1] as number) - 1e-9)).toBe(true);
  expect(run[0]).toBeLessThan((run[run.length - 1] as number) * 0.9);
  // finished: no more per-frame work while idle
  const count = done.length;
  await page.waitForTimeout(600);
  expect((await calls(page)).length).toBe(count);
  expect(errors).toEqual([]);
});

test("no reveal under reduced motion: the whole track appears at once", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await selectAndWaitForTrail(page);
  await page.waitForTimeout(1000);
  const done = await calls(page);
  const run = done.slice(done.findIndex((n) => n > 0));
  expect(run.length).toBeLessThanOrEqual(2); // the track, at most one later update
  expect(run[0]).toBeGreaterThan(0);
});
