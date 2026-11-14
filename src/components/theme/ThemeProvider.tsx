"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { THEME_STORAGE_KEY, type ResolvedTheme, type ThemeChoice } from "./theme";

type ThemeContextValue = {
  theme: ThemeChoice;
  resolvedTheme: ResolvedTheme;
  setTheme: (choice: ThemeChoice) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readPreference(): ThemeChoice {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // Storage may be unavailable in private browsing or restricted contexts.
  }
  return "system";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>("system");
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>("light");
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    let media: MediaQueryList | undefined;
    try {
      media = window.matchMedia("(prefers-color-scheme: dark)");
    } catch {
      // A missing media query API falls back to light.
    }
    const updateSystem = () => setSystemTheme(media?.matches ? "dark" : "light");
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY || event.key === null) {
        setThemeState(readPreference());
      }
    };

    // Hydrate deterministic server controls before reading browser-only preferences.
    // The head script already paints the correct theme.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThemeState(readPreference());
    updateSystem();
    setInitialized(true);
    media?.addEventListener("change", updateSystem);
    window.addEventListener("storage", onStorage);
    return () => {
      media?.removeEventListener("change", updateSystem);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const resolvedTheme: ResolvedTheme = theme === "system" ? systemTheme : theme;

  useEffect(() => {
    if (!initialized) return;
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [initialized, resolvedTheme]);

  const setTheme = useCallback((choice: ThemeChoice) => {
    setThemeState(choice);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, choice);
    } catch {
      // The current tab still honors the choice when storage is unavailable.
    }
  }, []);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (ctx) return ctx;

  if (process.env.NODE_ENV !== "production") {
    console.warn("useTheme called outside ThemeProvider; using safe defaults.");
  }

  return {
    theme: "system" as const,
    resolvedTheme: "light" as const,
    setTheme: () => {},
  };
}
