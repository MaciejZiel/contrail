import { describe, expect, it } from "vitest";
import type { AircraftRecord } from "../src/core/codec";
import { accepts, activeFilterCount, airlineCounts, DEFAULT_FILTERS } from "../src/core/filters";
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
    expect(activeFilterCount({ altMin: 1, altMax: 45000, airline: "RYR", hideGround: true })).toBe(3);
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
