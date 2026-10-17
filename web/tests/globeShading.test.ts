import { describe, expect, it } from "vitest";
import { GlobeShading } from "../src/map/globeShading";

describe("globe silhouette", () => {
  it("grows with zoom and stays inside a plausible size", () => {
    const h = 900;
    const a = GlobeShading.silhouetteRadius(1, 0, h);
    const b = GlobeShading.silhouetteRadius(2, 0, h);
    const c = GlobeShading.silhouetteRadius(3, 0, h);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    // zoom 2 at the equator: sphere radius 326 px, seen from 1350 px up; the outline is a little smaller
    expect(b).toBeGreaterThan(255);
    expect(b).toBeLessThan(290);
  });

  it("is larger away from the equator at the same zoom (zoom is matched to Mercator at the centre)", () => {
    expect(GlobeShading.silhouetteRadius(2, 60, 900)).toBeGreaterThan(GlobeShading.silhouetteRadius(2, 0, 900) * 1.6);
  });
});
