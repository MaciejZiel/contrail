import { describe, expect, it } from "vitest";
import { DEFAULT_VIEW, parseUrlState, preservedParams, serializeUrlState } from "../src/core/urlState";

describe("url state", () => {
  it("round trips the view", () => {
    const v = { lat: 52.2297, lon: 21.0122, zoom: 8.25, selected: "48ad08" };
    expect(parseUrlState(`?${serializeUrlState(v)}`)).toEqual(v);
  });

  it("falls back to defaults on junk", () => {
    expect(parseUrlState("?c=abc&z=nope&s=zz")).toEqual(DEFAULT_VIEW);
    expect(parseUrlState("")).toEqual(DEFAULT_VIEW);
  });

  it("clamps out of range values", () => {
    const v = parseUrlState("?c=120,500&z=99");
    expect(v.lat).toBe(85);
    expect(v.lon).toBe(180);
    expect(v.zoom).toBe(17);
  });

  it("keeps unrelated parameters", () => {
    expect(preservedParams("?c=1,2&z=3&bm=offline").toString()).toBe("bm=offline");
  });
});
