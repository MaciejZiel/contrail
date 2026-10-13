import { afterEach, describe, expect, it, vi } from "vitest";
import { MOVE_DEBOUNCE_MS, RecentTrailsLayer, trailFeatures } from "../src/map/recentTrailsLayer";

describe("recent trail features", () => {
  it("makes one coloured line per aircraft", () => {
    const f = trailFeatures([
      { h: "aaaaaa", p: [[10, 50, 350], [10.1, 50.1, 350]] },
      { h: "bbbbbb", p: [[11, 51, null], [11.1, 51.1, null], [11.2, 51.2, null]] },
    ]);
    expect(f).toHaveLength(2);
    expect(f[1]?.geometry.coordinates).toHaveLength(3);
    expect(f[0]?.properties.c).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
    expect(f[0]?.properties.c).not.toBe(f[1]?.properties.c); // 35,000 ft and unknown altitude differ
  });
  it("cuts a track where it crosses the antimeridian and drops lone points", () => {
    const f = trailFeatures([{ h: "cccccc", p: [[179.5, 10, 100], [179.9, 10, 100], [-179.8, 10, 100], [-179.4, 10, 100]] }]);
    expect(f.map((x) => x.geometry.coordinates.length)).toEqual([2, 2]);
    expect(trailFeatures([{ h: "dddddd", p: [[1, 1, 1]] }])).toEqual([]);
  });
});

describe("recent trails requests", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("waits for the map to stand still before asking again, and asks on the snapped grid", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("document", { baseURI: "http://localhost/" });
    const urls: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      urls.push(String(url));
      return Promise.resolve(new Response(JSON.stringify({ ok: true, total: 0, trails: [] }), { status: 200 }));
    });
    let moveend: () => void = () => undefined;
    const map = {
      isStyleLoaded: () => true,
      once: () => undefined,
      on: (_ev: string, fn: () => void) => (moveend = fn),
      addSource: () => undefined,
      addLayer: () => undefined,
      getLayer: () => undefined,
      getSource: () => ({ setData: () => undefined }),
      getZoom: () => 8,
      getBounds: () => ({ getWest: () => 14.13, getSouth: () => 48.07, getEast: () => 25.91, getNorth: () => 55.88 }),
    };
    const layer = new RecentTrailsLayer(map as never, () => "", () => undefined);
    layer.setMinutes(30);
    await vi.advanceTimersByTimeAsync(0);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("w=14&s=48&e=26&n=56&window=1800");
    for (let i = 0; i < 5; i++) {
      moveend();
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(urls).toHaveLength(1); // still moving
    await vi.advanceTimersByTimeAsync(MOVE_DEBOUNCE_MS);
    expect(urls).toHaveLength(2);
    layer.destroy();
  });
});
