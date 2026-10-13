import { describe, expect, it } from "vitest";
import { trailFeatures } from "../src/map/recentTrailsLayer";

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
