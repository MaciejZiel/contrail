import { applyTheme, loadPref, resolveTheme, savePref, systemPrefersDark, type Theme, type ThemePref } from "./theme";

/** Reactive theme state: the visitor's preference and the theme it resolves to right now. */
export const themeState = $state({ pref: "system" as ThemePref, theme: "dark" as Theme });

function refresh(): void {
  themeState.theme = resolveTheme(themeState.pref, systemPrefersDark());
  applyTheme(themeState.theme);
}

/** Read the stored preference and stamp the theme on the page; call before the first render. */
export function initTheme(): void {
  themeState.pref = loadPref();
  refresh();
  try {
    // "system" follows the operating system live
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (themeState.pref === "system") refresh();
    });
  } catch {
    // no media query support: the theme stays as resolved
  }
}

export function setThemePref(pref: ThemePref): void {
  themeState.pref = pref;
  savePref(pref);
  refresh();
}
