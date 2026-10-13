import { describe, expect, it } from "vitest";
import { rectForBounds, rectKey, rectQuery, rectTileCount } from "../src/core/tiles";

describe("rectForBounds", () => {
  it("covers the viewport", () => {
    // Warsaw area, roughly 4 degrees wide
    const r = rectForBounds({ west: 19, south: 51, east: 23, north: 53 });
    expect(r).toEqual({ x0: 39, y0: 28, x1: 40, y1: 28 });
    expect(rectQuery(r)).toBe("x0=39&y0=28&x1=40&y1=28");
    expect(rectKey(r)).toBe("39,28,40,28");
  });

  it("wraps across the antimeridian", () => {
    const r = rectForBounds({ west: 170, south: 0, east: 190, north: 10 });
    expect(r.x0).toBeGreaterThan(r.x1);
    expect(rectTileCount(r)).toBeGreaterThan(0);
  });

  it("handles world copies (longitudes beyond +-180)", () => {
    const r = rectForBounds({ west: -190, south: 0, east: -170, north: 10 });
    expect(r.x0).toBeGreaterThan(r.x1);
  });

  it("returns the full width for a world-sized view and clamps latitude", () => {
    const r = rectForBounds({ west: -360, south: -90, east: 360, north: 90 });
    expect([r.x0, r.x1, r.y0, r.y1]).toEqual([0, 71, 0, 35]);
    expect(rectTileCount(r)).toBe(72 * 36);
  });
});
