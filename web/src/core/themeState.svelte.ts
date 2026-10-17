import { applyTheme, loadTheme, saveTheme, type Theme } from "./theme";

/** Reactive theme state: the theme shown right now. */
export const themeState = $state({ theme: "dark" as Theme });

/** Read the stored choice and stamp the theme on the page; call before the first render. */
export function initTheme(): void {
  themeState.theme = loadTheme();
  applyTheme(themeState.theme);
}

export function setTheme(theme: Theme): void {
  themeState.theme = theme;
  saveTheme(theme);
  applyTheme(theme);
}
