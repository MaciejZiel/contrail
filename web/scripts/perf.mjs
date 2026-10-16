// Perf probe: inject N synthetic aircraft into a running app and measure frame times.
// Usage: node scripts/perf.mjs [baseUrl] [count]   (app must be served with the e2e hook, ?e2e=1)
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://127.0.0.1:9140";
const count = Number(process.argv[3] ?? 15000);
// GPU=1 tries the machine GPU; the default is software rendering (SwiftShader), which is far slower.
const args = process.env.GPU
  ? ["--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--use-gl=angle", "--use-angle=gl"]
  : ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
const browser = await chromium.launch({ args });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
// THROTTLE=6 emulates a CPU six times slower (a low-end phone).
if (process.env.THROTTLE) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.THROTTLE) });
}
await page.goto(`${base}/?e2e=1&bm=offline&c=${process.env.PC ?? "30,10"}&z=${process.env.PZ ?? "3"}${process.env.GLOBE ? "&g=1" : ""}`);
await page.waitForFunction(() => !!window.__flights);
if (process.env.WAIT) await page.waitForTimeout(Number(process.env.WAIT) * 1000);
// COUNT=0: measure the real traffic the server delivers instead of injecting synthetic aircraft
if (count > 0) await page.evaluate((n) => {
  const f = window.__flights;
  const now = Date.now();
  const records = [];
  for (let i = 0; i < n; i++) {
    records.push({
      hex: 0x900000 + i, lat: -60 + Math.random() * 120, lon: -180 + Math.random() * 360,
      track: Math.random() * 360, speedKt: 300 + Math.random() * 250, altFt: Math.random() * 40000, vrateFpm: 0,
      category: 2, flags: 0, ageS: 0, callsign: "PERF" + i, squawk: 0,
    });
  }
  f.store.apply({ serverNowMs: now, tiles: [{ tx: 0, ty: 0, fetchedAtMs: now, source: 9, records }] }, now / 1000);
}, count);
const result = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const times = [];
      let last = performance.now();
      const end = last + 4000;
      const tick = (t) => {
        times.push(t - last);
        last = t;
        if (t < end) requestAnimationFrame(tick);
        else {
          times.shift();
          times.sort((a, b) => a - b);
          const avg = times.reduce((a, b) => a + b, 0) / times.length;
          resolve({
            frames: times.length, avgFps: Math.round(1000 / avg), p95ms: times[Math.floor(times.length * 0.95)],
            maxMs: times.at(-1), cpuFrameMs: window.__flights.layer.stats.frameMs, visible: window.__flights.layer.stats.visible,
            total: window.__flights.layer.stats.total,
          });
        }
      };
      requestAnimationFrame(tick);
    }),
);
console.log(JSON.stringify(result));
await browser.close();
