export type ThemeChoice = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "theme-preference";

// Runs before the app hydrates so saved and system preferences paint immediately.
export const themeInitScript = `(() => {
  let preference = "system";
  try {
    const stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    if (stored === "light" || stored === "dark" || stored === "system") preference = stored;
  } catch {}
  let dark = false;
  try { dark = window.matchMedia("(prefers-color-scheme: dark)").matches; } catch {}
  const resolved = preference === "system" ? (dark ? "dark" : "light") : preference;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
})();`;
