import { describe, expect, it } from "vitest";
import type { Feature, LineString } from "geojson";
import { easeOutCubic, revealSequence, truncateLine } from "../src/map/reveal";

const seg = (a: [number, number], b: [number, number], c = "x"): Feature<LineString, { c: string }> => ({
  type: "Feature",
  properties: { c },
  geometry: { type: "LineString", coordinates: [a, b] },
});

describe("truncateLine", () => {
  const line = [[0, 0], [10, 0], [10, 10]];
  it("keeps everything at 1 and only the start at 0", () => {
    expect(truncateLine(line, 1)).toBe(line);
    expect(truncateLine(line, 0)).toEqual([[0, 0]]);
  });
  it("cuts by length, interpolating the end point", () => {
    expect(truncateLine(line, 0.25)).toEqual([[0, 0], [5, 0]]);
    expect(truncateLine(line, 0.75)).toEqual([[0, 0], [10, 0], [10, 5]]);
  });
  it("copes with repeated points", () => {
    expect(truncateLine([[1, 1], [1, 1]], 0.5)).toEqual([[1, 1], [1, 1]]);
  });
});

describe("revealSequence", () => {
  const segs = [seg([0, 0], [10, 0], "a"), seg([10, 0], [10, 10], "b"), seg([10, 10], [20, 10], "c")];
  it("returns all pieces at 1 and none at 0", () => {
    expect(revealSequence(segs, 1)).toBe(segs);
    expect(revealSequence(segs, 0)).toEqual([]);
  });
  it("keeps whole leading pieces and cuts the next, preserving colours", () => {
    const r = revealSequence(segs, 0.5); // 15 of 30 units
    expect(r.map((f) => f.properties.c)).toEqual(["a", "b"]);
    expect(r[1]?.geometry.coordinates).toEqual([[10, 0], [10, 5]]);
  });
  it("grows monotonically", () => {
    const len = (f: number) => revealSequence(segs, f).reduce((n, s) => n + s.geometry.coordinates.length, 0);
    expect(len(0.2)).toBeLessThanOrEqual(len(0.6));
    expect(len(0.6)).toBeLessThanOrEqual(len(1));
  });
});

describe("easeOutCubic", () => {
  it("runs 0..1, fast first", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
    expect(easeOutCubic(2)).toBe(1);
  });
});
