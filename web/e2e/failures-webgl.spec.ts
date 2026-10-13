import { expect, test } from "@playwright/test";
import { collectConsole, expectUsefulFallback, FIRST_VISIT } from "./failureHelpers";

// a browser without WebGL 2 (hardware acceleration off, or WebGL blocked by an extension or a policy)
test.use({ launchOptions: { args: ["--disable-webgl", "--disable-webgl2", "--disable-gpu", "--use-gl=disabled"] } });

test("explains what happened and how to fix it, and still lists live aircraft", async ({ page }) => {
  const logs = collectConsole(page);
  await page.goto(FIRST_VISIT);
  await expectUsefulFallback(page, "webgl");
  await expect(page.getByTestId("map-problem")).toContainText(/hardware acceleration/i);
  expect(logs.some((l) => l.includes("[contrail] map unavailable (webgl)"))).toBe(true);
});
