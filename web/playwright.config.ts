import { defineConfig, devices } from "@playwright/test";

const python = process.env.PYTHON ?? "python";
// Overridable so several checkouts can run the suite side by side on one machine.
const API_PORT = Number(process.env.E2E_API_PORT ?? 9140);
const UPSTREAM_PORT = Number(process.env.E2E_UPSTREAM_PORT ?? 9141);

const gpuArgs = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

/**
 * End-to-end tests run the real server and the real built frontend. Only the upstream differs:
 * a fixture server replays synthetic data shaped exactly like ADSB.lol responses.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${API_PORT}`, trace: "retain-on-failure", launchOptions: { args: gpuArgs } },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: [
    {
      command: `${python} -m flightmap.fixture_upstream --port ${UPSTREAM_PORT}`,
      cwd: "../server",
      url: `http://127.0.0.1:${UPSTREAM_PORT}/healthz`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `${python} -m flightmap`,
      cwd: "../server",
      url: `http://127.0.0.1:${API_PORT}/api/v1/health`,
      reuseExistingServer: !process.env.CI,
      env: {
        PORT: String(API_PORT),
        ADSBLOL_URL: `http://127.0.0.1:${UPSTREAM_PORT}`,
        UPSTREAM_BUDGET_RPS: "40",
        TILE_TTL_S: "3",
        STATIC_DIR: "../web/dist",
      },
    },
  ],
});
