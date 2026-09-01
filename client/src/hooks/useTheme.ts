/**
 * useTheme — read / write the current theme.
 *
 * Mode is one of "light" | "dark". Persists to localStorage under
 * `pb-theme`. The initial class on <html> is set by the inline script
 * in client/index.html (so React hydration matches the first paint).
 *
 * Source of truth is the `.dark` class on <html>. The hook reflects it
 * into React state on mount, and on every `setTheme` mutates the class,
 * writes localStorage, and updates the state — keeping all three in
 * sync without flicker.
 */
import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "pb-theme";

function readInitial(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function applyToDom(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readInitial);

  // Sync if another tab toggled the theme.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const next = e.newValue === "dark" ? "dark" : "light";
      setThemeState(next);
      applyToDom(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    applyToDom(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore — localStorage may be unavailable (private mode etc.) */
    }
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  return { theme, setTheme, toggleTheme };
}
