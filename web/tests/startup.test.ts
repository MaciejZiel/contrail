import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveWorkerUrl } from "../src/map/startup";

const reply = (status: number, type: string | null) =>
  Promise.resolve(new Response(null, { status, headers: type ? { "content-type": type } : {} }));

describe("resolveWorkerUrl", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("accepts a worker and shared chunk served as JavaScript", async () => {
    vi.stubGlobal("fetch", vi.fn(() => reply(200, "text/javascript")));
    const r = await resolveWorkerUrl("6.0.0-abc", "https://x.test/");
    expect(r).toEqual({ url: "https://x.test/maplibre/6.0.0-abc/maplibre-gl-worker.mjs" });
  });

  it("retries once with a cache-busting query when the worker has the wrong type, and uses that URL", async () => {
    const f = vi.fn((url: string) => reply(200, url.includes("cb=") || url.includes("shared") ? "text/javascript" : "text/plain"));
    vi.stubGlobal("fetch", f);
    const r = await resolveWorkerUrl("d", "https://x.test/");
    expect("url" in r && r.url).toMatch(/maplibre-gl-worker\.mjs\?cb=\d+$/);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("reports a worker that stays on the wrong type, naming what the server sent", async () => {
    vi.stubGlobal("fetch", vi.fn(() => reply(200, "text/plain; charset=utf-8")));
    const r = await resolveWorkerUrl("d", "https://x.test/");
    expect("problem" in r && r.problem.kind).toBe("worker");
    expect("problem" in r && r.problem.technical).toContain("text/plain");
  });

  it("reports a missing or blocked file", async () => {
    vi.stubGlobal("fetch", vi.fn(() => reply(404, null)));
    expect(await resolveWorkerUrl("d", "https://x.test/")).toHaveProperty("problem");
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    const r = await resolveWorkerUrl("d", "https://x.test/");
    expect("problem" in r && r.problem.technical).toContain("Failed to fetch");
  });

  it("reports a shared chunk with the wrong type even when the worker is fine", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => reply(200, url.includes("shared") ? "text/plain" : "text/javascript")));
    const r = await resolveWorkerUrl("d", "https://x.test/");
    expect("problem" in r && r.problem.technical).toContain("shared chunk");
  });
});
