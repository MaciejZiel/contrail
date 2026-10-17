/** Theme preference (what the visitor chose) and the theme actually shown. Pure helpers plus a thin storage layer. */
export type ThemePref = "system" | "light" | "dark";
export type Theme = "light" | "dark";

export const THEME_KEY = "contrail.theme";
export const PREFS: readonly ThemePref[] = ["system", "light", "dark"];

/** Anything that is not a known preference (missing, corrupted, from another version) means "follow the system". */
export function parsePref(raw: unknown): ThemePref {
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}

/** The theme to draw: an explicit choice wins, "system" follows prefers-color-scheme. */
export function resolveTheme(pref: ThemePref, systemDark: boolean): Theme {
  if (pref === "light") return "light";
  if (pref === "dark") return "dark";
  return systemDark ? "dark" : "light";
}

/** The next preference when the switch is pressed: system, light, dark, system... */
export function nextPref(pref: ThemePref): ThemePref {
  return PREFS[(PREFS.indexOf(pref) + 1) % PREFS.length] as ThemePref;
}

export function loadPref(): ThemePref {
  try {
    return parsePref(localStorage.getItem(THEME_KEY));
  } catch {
    return "system"; // storage blocked or unavailable
  }
}

export function savePref(pref: ThemePref): void {
  try {
    if (pref === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {
    // the choice then lasts for this visit only
  }
}

export function systemPrefersDark(): boolean {
  try {
    return matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return true; // the app was dark before there was a choice
  }
}

/** Browser chrome colour per theme (keep in step with --bg in app.css). */
export const THEME_COLOR: Record<Theme, string> = { dark: "#0d0f12", light: "#f3f1ed" };

/** Stamp the theme on the document: CSS tokens, form controls and the browser bar follow. */
export function applyTheme(theme: Theme, doc: Document = document): void {
  doc.documentElement.dataset.theme = theme;
  doc.documentElement.style.colorScheme = theme;
  doc.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
}
