import { describe, expect, it } from "vitest";
import { nextPref, parsePref, resolveTheme } from "../src/core/theme";

describe("theme resolution", () => {
  it("an explicit choice ignores the system setting", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
  it("system follows prefers-color-scheme", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
  it("unknown stored values fall back to system", () => {
    expect(parsePref(null)).toBe("system");
    expect(parsePref("")).toBe("system");
    expect(parsePref("blue")).toBe("system");
    expect(parsePref(42)).toBe("system");
    expect(parsePref("light")).toBe("light");
    expect(parsePref("dark")).toBe("dark");
    expect(parsePref("system")).toBe("system");
  });
  it("the switch cycles through all three and returns to the start", () => {
    expect(nextPref("system")).toBe("light");
    expect(nextPref("light")).toBe("dark");
    expect(nextPref("dark")).toBe("system");
  });
});
