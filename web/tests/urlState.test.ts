import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS } from "../src/core/filters";
import { DEFAULT_VIEW, parseUrlState, preservedParams, serializeUrlState } from "../src/core/urlState";

describe("url state", () => {
  it("round trips the view", () => {
    const v = { lat: 52.2297, lon: 21.0122, zoom: 8.25, selected: "48ad08", airport: null, filters: DEFAULT_FILTERS, trails: 0 as const, globe: false };
    expect(parseUrlState(`?${serializeUrlState(v)}`)).toEqual(v);
  });

  it("round trips the globe flag and keeps the flat map out of the URL", () => {
    expect(parseUrlState(`?${serializeUrlState({ ...DEFAULT_VIEW, globe: true })}`).globe).toBe(true);
    expect(serializeUrlState(DEFAULT_VIEW)).not.toContain("g=");
    expect(preservedParams("?g=1&e2e=1").has("g")).toBe(false);
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

  it("round trips airport and filters", () => {
    const v = {
      ...DEFAULT_VIEW,
      airport: "EPWA",
      filters: { altMin: 1000, altMax: 12000, airline: "RYR", hideGround: true, callsigns: ["LO", "N12"], types: ["A32*", "B738"] },
      trails: 60 as const,
    };
    const parsed = parseUrlState(`?${serializeUrlState(v)}`);
    expect(parsed.airport).toBe("EPWA");
    expect(parsed.filters).toEqual(v.filters);
    expect(parsed.trails).toBe(60);
    expect(serializeUrlState(v)).toContain("cs=LO%2CN12&ty=A32*%2CB738&tr=60".replace("A32*", "A32*"));
  });

  it("ignores broken filter values", () => {
    const f = parseUrlState("?alt=a-b&air=toolong&gnd=1&cs=%3Cb%3E&ty=toolong,%3Cx%3E&tr=45");
    expect(f.filters).toEqual(DEFAULT_FILTERS);
    expect(f.trails).toBe(0);
  });

  it("reads several callsign prefixes separated by commas or spaces", () => {
    expect(parseUrlState("?cs=lo,ryr").filters.callsigns).toEqual(["LO", "RYR"]);
    expect(parseUrlState("?cs=LO+RYR1%20N12").filters.callsigns).toEqual(["LO", "RYR1", "N12"]);
  });

  it("prefers a selected aircraft over an airport", () => {
    const v = parseUrlState("?s=48ad08&a=EPWA");
    expect([v.selected, v.airport]).toEqual(["48ad08", null]);
  });

  it("keeps unrelated parameters", () => {
    expect(preservedParams("?c=1,2&z=3&cs=LO%2CN12&ty=A320&tr=30&bm=offline").toString()).toBe("bm=offline");
  });
});
