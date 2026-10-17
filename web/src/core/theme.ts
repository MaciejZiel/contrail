/** The theme shown: the visitor's explicit choice (dark until they pick light). Pure helpers plus a thin storage layer. */
export type Theme = "light" | "dark";

export const THEME_KEY = "contrail.theme";
export const DEFAULT_THEME: Theme = "dark";

/** Anything that is not a known theme (missing, corrupted, "system" from an earlier version) means the default. */
export function parseTheme(raw: unknown): Theme {
  return raw === "light" || raw === "dark" ? raw : DEFAULT_THEME;
}

/** The theme the switch moves to. */
export function otherTheme(theme: Theme): Theme {
  return theme === "dark" ? "light" : "dark";
}

export function loadTheme(): Theme {
  try {
    return parseTheme(localStorage.getItem(THEME_KEY));
  } catch {
    return DEFAULT_THEME; // storage blocked or unavailable
  }
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // the choice then lasts for this visit only
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
