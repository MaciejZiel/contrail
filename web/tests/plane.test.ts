import { describe, expect, it } from "vitest";
import type { AircraftRecord } from "../src/core/codec";
import { latToY, lonToX, yToLat, xToLon } from "../src/core/geo";
import { BLEND_S, MAX_EXTRAPOLATION_S, Plane } from "../src/core/plane";
import { AircraftStore } from "../src/core/store";

function rec(over: Partial<AircraftRecord> = {}): AircraftRecord {
  return {
    hex: 0x48ad08, lat: 50, lon: 20, track: 90, speedKt: 450, altFt: 30000, vrateFpm: 0,
    category: 2, flags: 0, ageS: 0, callsign: "TEST1", squawk: 1000, ...over,
  };
}

describe("Plane dead reckoning", () => {
  it("moves east along the track and never fades", () => {
    const p = new Plane(1);
    p.update(rec(), 1000, 1000);
    const a = p.positionAt(1000);
    const b = p.positionAt(1060);
    expect(b.x).toBeGreaterThan(a.x);
    expect(b.y).toBeCloseTo(a.y, 9);
    const km = ((xToLon(b.x) - xToLon(a.x)) * 111.195 * Math.cos((50 * Math.PI) / 180));
    expect(km).toBeCloseTo((450 * 0.514444 * 60) / 1000, 1);
  });

  it("uses the position age so a stale fix starts further along", () => {
    const fresh = new Plane(1);
    const old = new Plane(2);
    fresh.update(rec({ ageS: 0 }), 1000, 1000);
    old.update(rec({ ageS: 30 }), 1000, 1000);
    expect(old.positionAt(1000).x).toBeGreaterThan(fresh.positionAt(1000).x);
  });

  it("holds the last predicted position after the extrapolation cap", () => {
    const p = new Plane(1);
    p.update(rec(), 1000, 1000);
    const cap = p.positionAt(1000 + MAX_EXTRAPOLATION_S);
    const later = p.positionAt(1000 + MAX_EXTRAPOLATION_S + 600);
    expect(later.x).toBe(cap.x);
  });

  it("does not move aircraft on the ground or without a track", () => {
    const g = new Plane(1);
    g.update(rec({ flags: 1 }), 1000, 1000);
    expect(g.positionAt(1100).x).toBe(g.positionAt(1000).x);
    const n = new Plane(2);
    n.update(rec({ track: null }), 1000, 1000);
    expect(n.positionAt(1100).x).toBe(n.positionAt(1000).x);
  });

  it("predicts altitude from the vertical rate and clamps at zero", () => {
    const p = new Plane(1);
    p.update(rec({ altFt: 10000, vrateFpm: 1200 }), 1000, 1000);
    expect(p.altitudeAt(1030)).toBeCloseTo(10600, 0);
    const d = new Plane(2);
    d.update(rec({ altFt: 100, vrateFpm: -3000 }), 1000, 1000);
    expect(d.altitudeAt(1010)).toBe(0);
  });

  it("ignores updates that are older than the current fix", () => {
    const p = new Plane(1);
    expect(p.update(rec({ lon: 20 }), 1000, 1000)).toBe(true);
    expect(p.update(rec({ lon: 19 }), 990, 1001)).toBe(false);
    expect(xToLon(p.mx0)).toBeCloseTo(20, 4);
  });

  it("blends a correction in smoothly instead of jumping", () => {
    const p = new Plane(1);
    p.update(rec({ lon: 20 }), 1000, 1000);
    // 10 s later the aircraft was predicted at ~+0.065 degrees; the new fix is 0.02 degrees behind that
    const predicted = p.positionAt(1010);
    p.update(rec({ lon: xToLon(predicted.x) - 0.02 }), 1010, 1010);
    const drawnNow = p.positionAt(1010);
    expect(drawnNow.x).toBeCloseTo(predicted.x, 6); // no jump at the instant of the update
    const settled = new Plane(9);
    settled.update(rec({ lon: xToLon(predicted.x) - 0.02 }), 1010, 1010);
    const mid = p.positionAt(1010 + BLEND_S / 2).x;
    const noBlend = settled.positionAt(1010 + BLEND_S / 2).x;
    expect(mid).toBeGreaterThan(noBlend); // still carrying part of the old offset
    const end = p.positionAt(1010 + BLEND_S + 0.1);
    expect(end.x).toBeCloseTo(settled.positionAt(1010 + BLEND_S + 0.1).x, 9);
  });

  it("snaps when the correction is huge", () => {
    const p = new Plane(1);
    p.update(rec({ lon: 20 }), 1000, 1000);
    p.update(rec({ lon: 60 }), 1010, 1010);
    expect(xToLon(p.positionAt(1010).x)).toBeCloseTo(60, 3);
  });

  it("eases the drawn heading along the short arc", () => {
    const p = new Plane(1);
    p.update(rec({ track: 350 }), 1000, 1000);
    p.update(rec({ track: 10 }), 1010, 1010);
    const h = p.easeTrack(0.2);
    expect(h > 350 || h < 10).toBe(true);
  });
});

describe("AircraftStore", () => {
  const snap = (hexes: number[], fetchedAtMs: number, tx = 40, ty = 28) => ({
    serverNowMs: fetchedAtMs,
    tiles: [{ tx, ty, fetchedAtMs, source: 1, records: hexes.map((h) => rec({ hex: h })) }],
  });

  it("adds aircraft and removes the ones that left a refreshed tile", () => {
    const s = new AircraftStore();
    s.apply(snap([1, 2, 3], 1_000_000), 1000);
    expect(s.size).toBe(3);
    s.apply(snap([1, 3], 1_005_000), 1005);
    expect(s.size).toBe(2);
    expect(s.get(2)).toBeUndefined();
  });

  it("keeps an aircraft that moved into another tile", () => {
    const s = new AircraftStore();
    s.apply(snap([1], 1_000_000, 40, 28), 1000);
    s.apply(snap([1], 1_004_000, 41, 28), 1004); // seen in the neighbour first
    s.apply(snap([], 1_005_000, 40, 28), 1005); // then the old tile refreshes without it
    expect(s.get(1)).toBeDefined();
  });

  it("prunes data older than the limit", () => {
    const s = new AircraftStore();
    s.apply(snap([1, 2], 1_000_000), 1000);
    s.prune(1000 + 1000, 900);
    expect(s.size).toBe(0);
  });

  it("exposes a stable plane list for the renderer", () => {
    const s = new AircraftStore();
    s.apply(snap([5, 6], 1_000_000), 1000);
    expect(s.planes.map((p) => p.hex).sort()).toEqual([5, 6]);
    expect(latToY(50)).toBeGreaterThan(0);
    expect(yToLat(latToY(50))).toBeCloseTo(50, 6);
    expect(lonToX(0)).toBe(0.5);
  });
});
