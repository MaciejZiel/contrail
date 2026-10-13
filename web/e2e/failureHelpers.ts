import { expect, type Page } from "@playwright/test";

export const FIRST_VISIT = "/?e2e=1&bm=offline&c=50,10&z=5";

export function collectConsole(page: Page): string[] {
  const logs: string[] = [];
  page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
  return logs;
}

export async function expectUsefulFallback(page: Page, kind: string): Promise<void> {
  const problem = page.getByTestId("map-problem");
  await expect(problem).toBeVisible({ timeout: 25_000 });
  await expect(problem).toHaveAttribute("data-kind", kind);
  await expect(problem.getByRole("heading", { level: 1 })).not.toHaveText("");
  await expect(problem.getByRole("button", { name: "Reload", exact: true })).toBeVisible();
  // something useful is still shown: a live list of aircraft, with details one click away
  const first = problem.getByRole("list", { name: "Aircraft near the requested view" }).getByRole("button").first();
  await expect(first).toBeVisible({ timeout: 25_000 });
  await first.click();
  await expect(problem.getByTestId("aircraft-panel")).toBeVisible();
  // and the status pill is not stuck on "Loading traffic"
  await expect(page.locator(".chip")).not.toContainText("Loading traffic");
}
