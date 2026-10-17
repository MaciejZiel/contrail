import { describe, expect, it } from "vitest";
import { altitudeRgb, ramp } from "../src/map/palette";
import { COLORS } from "../src/map/style";
import { spriteFor, SPRITE } from "../src/map/sprites";

describe("palette", () => {
  it("gets lighter with altitude and stays in the blue family at the bottom", () => {
    const lum = (c: number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    const steps = [0, 5000, 15000, 28000, 40000].map((ft) => lum(altitudeRgb(ft, false)));
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThan(steps[i - 1]!);
    const low = altitudeRgb(0, false);
    expect(low[2]).toBeGreaterThan(low[0]);
    expect(altitudeRgb(99999, false)).toEqual(altitudeRgb(40000, false));
  });
  it("on the light theme gets deeper with altitude and every colour reads against land and water", () => {
    const lin = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const L = (c: readonly number[]) => 0.2126 * lin(c[0]!) + 0.7152 * lin(c[1]!) + 0.0722 * lin(c[2]!);
    const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const contrast = (a: readonly number[], b: readonly number[]) => (Math.max(L(a), L(b)) + 0.05) / (Math.min(L(a), L(b)) + 0.05);
    const steps = [0, 5000, 15000, 28000, 40000].map((ft) => altitudeRgb(ft, false, "light"));
    for (let i = 1; i < steps.length; i++) expect(L(steps[i]!)).toBeLessThan(L(steps[i - 1]!));
    for (const ground of [COLORS.light.land, COLORS.light.water]) {
      for (const c of [...steps, altitudeRgb(null, false, "light"), altitudeRgb(0, true, "light"), ramp("light").ghost, ramp("light").accent]) {
        expect(contrast(c, hex(ground))).toBeGreaterThanOrEqual(3);
      }
    }
  });
  it("greys out ground traffic and unknown altitude", () => {
    expect(altitudeRgb(5000, true)).not.toEqual(altitudeRgb(5000, false));
    expect(altitudeRgb(null, false)).toHaveLength(3);
  });
  it("chooses sprites by category", () => {
    expect(spriteFor(4, false).cell).toBe(SPRITE.rotor);
    expect(spriteFor(3, false).scale).toBeGreaterThan(1);
    expect(spriteFor(0, true).scale).toBeLessThan(1);
  });
});
