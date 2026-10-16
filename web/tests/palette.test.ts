import { describe, expect, it } from "vitest";
import { altitudeRgb } from "../src/map/palette";
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
