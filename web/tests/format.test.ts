import { describe, expect, it } from "vitest";
import { fmtAge, fmtAlt, fmtSpeed, fmtVrate, haversineKm, progressAlong, squawkMeaning } from "../src/core/format";

describe("formatting", () => {
  it("shows flight levels at cruise and feet below", () => {
    expect(fmtAlt(36000)).toBe("FL360");
    expect(fmtAlt(4500)).toBe("4,500 ft");
    expect(fmtAlt(null)).toBe("–");
    expect(fmtAlt(0, true)).toBe("On ground");
  });
  it("formats speed and vertical rate", () => {
    expect(fmtSpeed(448.6)).toBe("449 kt");
    expect(fmtVrate(0)).toBe("level");
    expect(fmtVrate(1984)).toBe("+1,980 ft/min");
    expect(fmtVrate(-2200)).toBe("−2,200 ft/min");
  });
  it("describes data age", () => {
    expect(fmtAge(0.4)).toBe("just now");
    expect(fmtAge(12)).toBe("12 s ago");
    expect(fmtAge(300)).toBe("5 min ago");
  });
  it("knows the emergency squawks", () => {
    expect(squawkMeaning(7700)).toBe("General emergency");
    expect(squawkMeaning(1000)).toBeNull();
  });
});

describe("geometry", () => {
  it("computes great circle distance", () => {
    expect(haversineKm(52.1657, 20.9671, 43.6772, -79.6306)).toBeGreaterThan(6500);
    expect(haversineKm(0, 0, 0, 0)).toBe(0);
  });
  it("measures progress along a route", () => {
    const a = { lat: 52.1657, lon: 20.9671 };
    const b = { lat: 43.6772, lon: -79.6306 };
    expect(progressAlong(a, b, a.lat, a.lon)).toBeCloseTo(0, 3);
    expect(progressAlong(a, b, b.lat, b.lon)).toBeCloseTo(1, 3);
    expect(progressAlong(a, b, 60, -20)).toBeGreaterThan(0.3);
  });
});
