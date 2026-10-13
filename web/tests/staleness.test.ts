import { describe, expect, it } from "vitest";
import { limits, staleOpacity } from "../src/core/staleness";

describe("staleness", () => {
  it("shows fresh data, dims old data and hides data past the cap", () => {
    expect(limits.hideAfterS).toBe(900);
    expect(staleOpacity(5)).toBe(1);
    expect(staleOpacity(599)).toBe(1);
    expect(staleOpacity(600)).toBeLessThan(1);
    expect(staleOpacity(600)).toBeGreaterThan(0);
    expect(staleOpacity(900)).toBe(0);
    expect(staleOpacity(5000)).toBe(0);
  });
});
