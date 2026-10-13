import { beforeEach, describe, expect, it } from "vitest";
import { resetClock, serverNow, syncServerTime } from "../src/core/clock";

describe("server clock", () => {
  beforeEach(resetClock);

  it("follows the server time", () => {
    syncServerTime(50_000, 10_000);
    expect(serverNow(11_000)).toBe(51);
  });

  it("is not pulled back by a late or cached sample", () => {
    syncServerTime(50_000, 10_000);
    // a body from the browser cache, stamped 6 s before it was used
    syncServerTime(50_000, 16_000);
    expect(serverNow(16_000)).toBe(56);
  });

  it("forgets old samples so a device clock change is followed", () => {
    syncServerTime(50_000, 10_000);
    for (let i = 1; i <= 12; i++) syncServerTime(50_000 + i * 1000, 20_000 + i * 1000);
    expect(serverNow(40_000)).toBe(70);
  });
});
