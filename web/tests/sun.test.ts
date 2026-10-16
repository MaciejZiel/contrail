import { describe, expect, it } from "vitest";
import { subsolarPoint, sunInView, sunLight } from "../src/map/sun";

describe("sun position", () => {
  it("is over the Tropic of Cancer at the June solstice", () => {
    const p = subsolarPoint(new Date("2026-06-21T08:25:00Z"));
    expect(p.lat).toBeGreaterThan(23.2);
    expect(p.lat).toBeLessThan(23.6);
  });

  it("is on the equator at the March equinox and near the Greenwich meridian at noon UTC", () => {
    const p = subsolarPoint(new Date("2026-03-20T12:00:00Z"));
    expect(Math.abs(p.lat)).toBeLessThan(1);
    expect(Math.abs(p.lon)).toBeLessThan(5);
  });

  it("moves 15 degrees west per hour", () => {
    const a = subsolarPoint(new Date("2026-10-17T10:00:00Z"));
    const b = subsolarPoint(new Date("2026-10-17T11:00:00Z"));
    const d = ((a.lon - b.lon + 540) % 360) - 180;
    expect(d).toBeGreaterThan(14.9);
    expect(d).toBeLessThan(15.1);
  });
});

describe("sun light on the disc", () => {
  const view = { radius: 326, camera: 1350, rim: 268 };
  it("is full where the Sun is overhead and negative on the far side of the terminator", () => {
    // Sun straight behind the viewer: the middle of the disc is fully lit, the edge less
    const sun = sunInView({ lat: 0, lon: 0 }, 0, 0);
    expect(sunLight(0, 0, view, sun)).toBeCloseTo(1, 5);
    expect(sunLight(0.9, 0, view, sun) as number).toBeLessThan(0.6);
    // Sun on the left horizon: the right half of the disc is dark
    const side = sunInView({ lat: 0, lon: -90 }, 0, 0);
    expect(sunLight(-0.8, 0, view, side) as number).toBeGreaterThan(0.3);
    expect(sunLight(0.8, 0, view, side) as number).toBeLessThan(0);
  });
  it("has no light outside the globe", () => {
    expect(sunLight(1.2, 0, view, sunInView({ lat: 0, lon: 0 }, 0, 0))).toBeNull();
  });
});
