import { describe, expect, it } from "vitest";
import { altitudeRgb } from "../src/map/palette";
import { spriteFor, SPRITE } from "../src/map/sprites";

describe("palette", () => {
  it("is ordered from warm at low altitude to violet at the top", () => {
    const low = altitudeRgb(0, false);
    const high = altitudeRgb(40000, false);
    expect(low[0]).toBeGreaterThan(low[2]);
    expect(high[2]).toBeGreaterThan(high[0] - 1);
    expect(altitudeRgb(99999, false)).toEqual(high);
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
