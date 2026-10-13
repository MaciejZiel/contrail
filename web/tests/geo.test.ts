import { describe, expect, it } from "vitest";
import { angleDiff, latToY, lonToX, mercatorVelocity, xToLon, yToLat } from "../src/core/geo";

describe("mercator", () => {
  it("round trips coordinates", () => {
    for (const [lat, lon] of [[52.23, 21.01], [-33.9, 151.2], [0, 0], [70, -150]] as const) {
      expect(yToLat(latToY(lat))).toBeCloseTo(lat, 8);
      expect(xToLon(lonToX(lon))).toBeCloseTo(lon, 8);
    }
  });

  it("puts the equator and prime meridian in the middle", () => {
    expect(lonToX(0)).toBe(0.5);
    expect(latToY(0)).toBeCloseTo(0.5, 12);
  });

  it("clamps latitudes beyond the Mercator limit", () => {
    expect(Number.isFinite(latToY(90))).toBe(true);
    expect(latToY(90)).toBeGreaterThanOrEqual(0);
  });
});

describe("mercatorVelocity", () => {
  it("moves east for track 90 and north (decreasing y) for track 0", () => {
    const east = mercatorVelocity(0, 90, 450);
    expect(east.vx).toBeGreaterThan(0);
    expect(Math.abs(east.vy)).toBeLessThan(1e-12);
    const north = mercatorVelocity(0, 0, 450);
    expect(north.vy).toBeLessThan(0);
    expect(Math.abs(north.vx)).toBeLessThan(1e-12);
  });

  it("matches a great circle step to within metres over two minutes", () => {
    // 450 kt due north from 50N for 120 s is ~27.8 km = 0.2497 degrees of latitude
    const { vy } = mercatorVelocity(50, 0, 450);
    const y0 = latToY(50);
    const lat1 = yToLat(y0 + vy * 120);
    const expectedDeg = (450 * 0.514444 * 120) / 111_195;
    expect(lat1 - 50).toBeCloseTo(expectedDeg, 2);
  });

  it("covers more longitude per metre at high latitude", () => {
    expect(mercatorVelocity(60, 90, 400).vx).toBeGreaterThan(mercatorVelocity(0, 90, 400).vx);
  });
});

describe("angleDiff", () => {
  it("takes the short way around", () => {
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(10, 350)).toBe(-20);
    expect(angleDiff(0, 180)).toBe(180);
  });
});
