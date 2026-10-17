import { afterEach, describe, expect, it, vi } from "vitest";
import { limits, loadLimits, staleOpacity } from "../src/core/staleness";

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

  describe("limits from the server status", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      limits.dimAfterS = 600;
      limits.hideAfterS = 900;
    });
    const serve = (body: object) => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => body })));

    it("keeps ghosts on screen until ghost_age_s", async () => {
      serve({ max_age_s: 900, ghost_age_s: 1800 });
      await loadLimits("./");
      expect(limits.dimAfterS).toBe(600);
      expect(limits.hideAfterS).toBe(1800);
      expect(staleOpacity(1200)).toBe(0.5);
      expect(staleOpacity(1800)).toBe(0);
    });

    it("hides at max_age_s for an older server without a ghost window", async () => {
      serve({ max_age_s: 900 });
      await loadLimits("./");
      expect(limits.hideAfterS).toBe(900);
    });

    it("ignores a ghost window shorter than the dim point", async () => {
      serve({ max_age_s: 900, ghost_age_s: 100 });
      await loadLimits("./");
      expect(limits.hideAfterS).toBe(900);
    });
  });
});
