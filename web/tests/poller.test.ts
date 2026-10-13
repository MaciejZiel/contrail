import { describe, expect, it } from "vitest";
import { classify, summarize } from "../src/core/poller";

describe("feed freshness", () => {
  it("classifies by median tile age", () => {
    expect(classify(5)).toBe("live");
    expect(classify(60)).toBe("delayed");
    expect(classify(600)).toBe("stale");
  });

  it("summarises tile ages", () => {
    const now = 1_000_000;
    const s = summarize(
      {
        serverNowMs: now,
        tiles: [2000, 10000, 90000].map((age, i) => ({ tx: i, ty: 0, fetchedAtMs: now - age, source: 1, records: [] })),
      },
      3,
    );
    expect(s.tiles).toBe(3);
    expect(s.pending).toBe(3);
    expect(s.newestAgeS).toBe(2);
    expect(s.oldestAgeS).toBe(90);
    expect(s.medianAgeS).toBe(10);
    expect(s.state).toBe("live");
  });

  it("reports loading when no tile has data yet", () => {
    expect(summarize({ serverNowMs: 1, tiles: [] }, 4).state).toBe("loading");
  });
});
