import { describe, expect, it } from "vitest";
import { estimateArrival, fmtDistance, fmtDuration, fmtUtc, greatCircle } from "../src/core/geodesy";
import { haversineKm } from "../src/core/format";

describe("greatCircle", () => {
  it("runs from start to end along the short way", () => {
    const [seg] = greatCircle(52.17, 20.97, 43.68, -79.63, 40);
    expect(seg![0]![0]).toBeCloseTo(20.97, 6);
    expect(seg![0]![1]).toBeCloseTo(52.17, 6);
    const last = seg![seg!.length - 1]!;
    expect(last[0]).toBeCloseTo(-79.63, 3);
    expect(last[1]).toBeCloseTo(43.68, 3);
    // the Atlantic crossing bulges north of the straight lat/lon line
    const maxLat = Math.max(...seg!.map((p) => p[1]));
    expect(maxLat).toBeGreaterThan(52.17);
  });
  it("splits at the antimeridian", () => {
    const segs = greatCircle(35.5, 139.7, 37.6, -122.4, 60);
    expect(segs.length).toBeGreaterThanOrEqual(2);
    for (const s of segs) for (let i = 1; i < s.length; i++) expect(Math.abs(s[i]![0] - s[i - 1]![0])).toBeLessThan(180);
  });
  it("is consistent with the haversine distance", () => {
    const pts = greatCircle(10, 10, 20, 30, 50)[0]!;
    let sum = 0;
    for (let i = 1; i < pts.length; i++) sum += haversineKm(pts[i - 1]![1], pts[i - 1]![0], pts[i]![1], pts[i]![0]);
    expect(sum).toBeCloseTo(haversineKm(10, 10, 20, 30), 0);
  });
  it("handles identical endpoints", () => {
    expect(greatCircle(1, 1, 1, 1)).toEqual([[[1, 1]]]);
  });
});

describe("arrival estimate", () => {
  it("divides distance by ground speed", () => {
    const eta = estimateArrival(1852, 500, new Date("2026-10-13T12:00:00Z"));
    expect(eta!.minutes).toBeCloseTo(120, 5);
    expect(fmtUtc(eta!.arrivalUtc)).toBe("14:00 UTC");
  });
  it("gives no estimate when the speed is unknown or tiny", () => {
    expect(estimateArrival(500, null, new Date())).toBeNull();
    expect(estimateArrival(500, 40, new Date())).toBeNull();
  });
  it("formats durations and distances", () => {
    expect(fmtDuration(45)).toBe("45 min");
    expect(fmtDuration(125)).toBe("2 h 05 min");
    expect(fmtDistance(1852)).toBe("1,852 km (1,000 nm)");
  });
});
