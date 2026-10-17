import { describe, expect, it } from "vitest";
import { otherTheme, parseTheme } from "../src/core/theme";

describe("theme", () => {
  it("unknown stored values (including the old 'system') fall back to dark", () => {
    expect(parseTheme(null)).toBe("dark");
    expect(parseTheme("")).toBe("dark");
    expect(parseTheme("system")).toBe("dark");
    expect(parseTheme(42)).toBe("dark");
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
  });
  it("the switch toggles between light and dark", () => {
    expect(otherTheme("dark")).toBe("light");
    expect(otherTheme("light")).toBe("dark");
  });
});
