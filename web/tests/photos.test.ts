import { describe, expect, it } from "vitest";
import { parsePhotoResponse } from "../src/core/planespotters";
import { trailSegments } from "../src/map/trailLayer";

describe("Planespotters response", () => {
  const body = {
    photos: [
      {
        id: "000001",
        thumbnail: { src: "https://cdn.planespotters.net/t.jpg", size: { width: 200, height: 133 } },
        thumbnail_large: { src: "https://cdn.planespotters.net/l.jpg", size: { width: 420, height: 280 } },
        link: "https://www.planespotters.net/photo/000001/x",
        photographer: "Thomas Noack",
      },
    ],
  };

  it("keeps URLs unchanged and the photographer credit", () => {
    expect(parsePhotoResponse(body)).toEqual({
      thumbnail: "https://cdn.planespotters.net/l.jpg",
      width: 420,
      height: 280,
      link: "https://www.planespotters.net/photo/000001/x",
      photographer: "Thomas Noack",
    });
  });

  it("returns null for empty, error or incomplete responses", () => {
    expect(parsePhotoResponse({ photos: [] })).toBeNull();
    expect(parsePhotoResponse({ error: "nope" })).toBeNull();
    expect(parsePhotoResponse({ photos: [{ thumbnail: { src: "x" }, link: "y" }] })).toBeNull(); // no photographer
    expect(parsePhotoResponse(null)).toBeNull();
  });
});

describe("trail segments", () => {
  it("builds coloured segments and skips antimeridian jumps", () => {
    const segs = trailSegments({
      t: [0, 10, 20, 30],
      lat: [50, 50.1, 50.2, 50.3],
      lon: [179.9, -179.9, -179.8, -179.7],
      alt: [1000, 5000, 20000, 35000],
      gs: [], vr: [],
    });
    expect(segs).toHaveLength(2); // the first pair crosses +-180 and is dropped
    expect(segs[0]!.properties.c).not.toBe(segs[1]!.properties.c);
  });
});
