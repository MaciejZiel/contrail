import { describe, expect, it } from "vitest";
import { INITIAL_STATUS, type FeedStatus } from "../src/core/poller";
import { detail, label, tone } from "../src/ui/freshness";

const st = (o: Partial<FeedStatus>): FeedStatus => ({ ...INITIAL_STATUS, state: "live", tiles: 8, freshTiles: 2, ...o });

describe("freshness pill", () => {
  it("is calm and green while the median age is under a minute", () => {
    const s = st({ medianAgeS: 20, oldestAgeS: 80 });
    expect(label(s, 171)).toBe("Live, refreshing coverage · 171 aircraft");
    expect(tone(s)).toBe("ok");
  });
  it("states the median age instead of claiming it updated recently", () => {
    const s = st({ state: "aging", medianAgeS: 540, oldestAgeS: 100 });
    expect(label(s, 5)).toBe("Refreshing coverage, median age 9 min · 5 aircraft");
    expect(label(s, 5)).not.toMatch(/Updated/);
    expect(tone(s)).toBe("neutral");
  });
  it("turns amber when the oldest area is older than two minutes, never red", () => {
    const s = st({ state: "aging", medianAgeS: 300, oldestAgeS: 540 });
    expect(tone(s)).toBe("warn");
    expect(label(s, 5)).toContain("oldest area 9 min");
    expect(tone(st({ state: "old", medianAgeS: 800, oldestAgeS: 900 }))).toBe("warn");
  });
  it("is red only when the feed is down", () => {
    const s = st({ state: "offline", tiles: 0, error: "x" });
    expect(tone(s)).toBe("bad");
    expect(label(s, 0)).toBe("Can't reach the traffic feed, retrying");
  });
  it("shows median and oldest age in the tooltip", () => {
    expect(detail(st({ medianAgeS: 540, oldestAgeS: 600, newestAgeS: 30 }))).toMatch(/Median data age 9 min, oldest area 10 min/);
  });
});
