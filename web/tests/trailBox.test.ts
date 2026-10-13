import { describe, expect, it } from "vitest";
import { snapBox } from "../src/core/trailBox";

describe("trail box snapping", () => {
  it("grows outwards onto a grid and is shared by nearby viewers", () => {
    const a = snapBox({ west: 14.13, south: 48.07, east: 25.91, north: 55.88 });
    expect(a.west).toBeLessThanOrEqual(14.13);
    expect(a.east).toBeGreaterThanOrEqual(25.91);
    expect(a.north).toBeGreaterThanOrEqual(55.88);
    expect(snapBox({ west: 14.2, south: 48.1, east: 25.8, north: 55.8 })).toEqual(a);
  });
  // the same numbers as server/tests/test_recent_trails.py (SnapBoxTest), so both sides build one URL
  it("matches the server's grid", () => {
    expect(snapBox({ west: 14.13, south: 48.07, east: 25.91, north: 55.88 })).toEqual({ west: 14, south: 48, east: 26, north: 56 });
  });
  it("keeps an antimeridian crossing and turns a huge box into the whole world", () => {
    const x = snapBox({ west: 170.2, south: -10, east: 189.7, north: 10 });
    expect(x).toEqual({ west: 170, south: -10, east: -170, north: 10 });
    expect(snapBox({ west: -300, south: -90, east: 300, north: 90 })).toEqual({ west: -180, south: -90, east: 180, north: 90 });
  });
});
