import { describe, expect, it } from "vitest";
import type { AircraftRecord } from "../src/core/codec";
import { accepts, activeFilterCount, airlineCounts, parseCallsigns, DEFAULT_FILTERS, parseTypes, serverFilterQuery } from "../src/core/filters";
import { Plane } from "../src/core/plane";
import { cloudsText, visibilityText, windText } from "../src/core/metar";
import type { MetarData } from "../src/core/api";

function plane(over: Partial<AircraftRecord>): Plane {
  const p = new Plane(over.hex ?? 1);
  p.update(
    { hex: 1, lat: 50, lon: 10, track: 90, speedKt: 400, altFt: 30000, vrateFpm: 0, category: 2, flags: 0, ageS: 0, callsign: "RYR12AB", squawk: 0, ...over },
    1000,
    1000,
  );
  return p;
}

describe("filters", () => {
  it("passes everything by default", () => {
    expect(accepts(plane({}), DEFAULT_FILTERS)).toBe(true);
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
  });
  it("filters by altitude range, treating ground traffic as zero feet", () => {
    const f = { ...DEFAULT_FILTERS, altMin: 10000, altMax: 20000 };
    expect(accepts(plane({ altFt: 15000 }), f)).toBe(true);
    expect(accepts(plane({ altFt: 30000 }), f)).toBe(false);
    expect(accepts(plane({ altFt: 5000 }), f)).toBe(false);
    expect(accepts(plane({ altFt: null }), f)).toBe(true);
    expect(accepts(plane({ altFt: null, flags: 1 }), f)).toBe(false);
  });
  it("filters by airline designator and hides ground traffic", () => {
    expect(accepts(plane({}), { ...DEFAULT_FILTERS, airline: "RYR" })).toBe(true);
    expect(accepts(plane({ callsign: "LOT45" }), { ...DEFAULT_FILTERS, airline: "RYR" })).toBe(false);
    expect(accepts(plane({ flags: 1 }), { ...DEFAULT_FILTERS, hideGround: true })).toBe(false);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, altMin: 1, airline: "RYR", hideGround: true })).toBe(3);
  });
  it("filters by callsign prefix", () => {
    const f = { ...DEFAULT_FILTERS, callsigns: ["RYR1"] };
    expect(accepts(plane({}), f)).toBe(true);
    expect(accepts(plane({ callsign: "RYR22" }), f)).toBe(false);
    expect(accepts(plane({ callsign: "" }), f)).toBe(false);
    expect(activeFilterCount(f)).toBe(1);
  });
  it("filters by any of several callsign prefixes", () => {
    const f = { ...DEFAULT_FILTERS, callsigns: ["LO", "RYR"] };
    expect(accepts(plane({ callsign: "LOT45" }), f)).toBe(true);
    expect(accepts(plane({ callsign: "RYR22" }), f)).toBe(true);
    expect(accepts(plane({ callsign: "WZZ1" }), f)).toBe(false);
    expect(activeFilterCount(f)).toBe(1);
  });
  it("filters by type through the list of addresses the server provides", () => {
    const f = { ...DEFAULT_FILTERS, types: ["A32*"] };
    const p = plane({ hex: 7 });
    expect(accepts(p, f, null)).toBe(false); // not loaded yet
    expect(accepts(p, f, new Set([7]))).toBe(true);
    expect(accepts(p, f, new Set([8]))).toBe(false);
    expect(accepts(p, DEFAULT_FILTERS, null)).toBe(true);
  });
  it("cleans typed callsigns and type lists", () => {
    expect(parseCallsigns("LO,RYR")).toEqual(["LO", "RYR"]);
    expect(parseCallsigns(" lo, ryr1  n12;lo ")).toEqual(["LO", "RYR1", "N12"]);
    expect(parseCallsigns("lo-t, 123456789, ok")).toEqual(["OK"]);
    expect(parseCallsigns("a,b,c,d,e,f,g,h,i,j")).toHaveLength(8);
    expect(parseTypes("a32*, B738 b738;<x> toolong *")).toEqual(["A32*", "B738"]);
    expect(parseTypes("1,2,3,4,5,6,7,8,9,10")).toHaveLength(8);
  });
  it("sends only what changes the server's answer", () => {
    const f = { ...DEFAULT_FILTERS, callsigns: ["LO", "RYR"], types: ["A32*", "B738"], altMax: 12000, hideGround: true, airline: "LOT" };
    expect(serverFilterQuery(f)).toBe("&cs=LO%2CRYR&air=LOT&ty=A32*%2CB738");
    expect(serverFilterQuery(f, true)).toBe("&alt=0-12000&gnd=0&cs=LO%2CRYR&air=LOT&ty=A32*%2CB738");
    expect(serverFilterQuery(DEFAULT_FILTERS)).toBe("");
  });
  it("counts airlines among visible callsigns", () => {
    const planes = [plane({ callsign: "RYR1AB" }), plane({ callsign: "RYR22" }), plane({ callsign: "LOT45" }), plane({ callsign: "N123AB" })];
    expect(airlineCounts(planes)).toEqual([["RYR", 2], ["LOT", 1]]);
  });
});

describe("METAR text", () => {
  const m: MetarData = {
    observed_at: 0, raw: "", temp_c: 10, dewpoint_c: 7, wind_dir: 30, wind_variable: false, wind_kt: 4, gust_kt: 12,
    visibility_m: 9656, visibility_plus: true, qnh_hpa: 1026, weather: "", flight_category: "VFR",
    clouds: [{ cover: "FEW", base_ft: 2000 }, { cover: "BKN", base_ft: 4400 }],
  };
  it("describes wind, visibility and clouds", () => {
    expect(windText(m)).toBe("030° 4 kt, gusts 12 kt");
    expect(windText({ ...m, wind_variable: true, wind_dir: null, gust_kt: null, wind_kt: 2 })).toBe("Variable 2 kt");
    expect(windText({ ...m, wind_kt: 0 })).toBe("Calm");
    expect(visibilityText(m)).toBe("10 km or more");
    expect(visibilityText({ ...m, visibility_m: 4828, visibility_plus: false })).toBe("4.8 km");
    expect(cloudsText(m)).toBe("Few 2,000 ft · Broken 4,400 ft");
    expect(cloudsText({ ...m, clouds: [] })).toBe("Clear");
  });
});
