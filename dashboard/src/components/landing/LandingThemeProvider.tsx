"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type LandingTheme = "dark" | "light";

interface LandingThemeContextValue {
  theme: LandingTheme;
  setTheme: (theme: LandingTheme) => void;
}

const LandingThemeContext = createContext<LandingThemeContextValue | null>(null);

const STORAGE_KEY = "styx-theme";

function applyTheme(theme: LandingTheme) {
  document.documentElement.setAttribute("data-theme", theme);
}

export function LandingThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [theme, setThemeState] = useState<LandingTheme>("dark");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    const initial: LandingTheme =
      stored === "dark" || stored === "light"
        ? stored
        : "dark";
    setThemeState(initial);
    applyTheme(initial);

    return () => {
      document.documentElement.removeAttribute("data-theme");
    };
  }, []);

  function setTheme(next: LandingTheme) {
    setThemeState(next);
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
  }

  return (
    <LandingThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </LandingThemeContext.Provider>
  );
}

export function useLandingTheme(): LandingThemeContextValue {
  const ctx = useContext(LandingThemeContext);
  if (!ctx) {
    throw new Error(
      "useLandingTheme must be used within a <LandingThemeProvider>"
    );
  }
  return ctx;
}

/**
 * Same as useLandingTheme but returns null when used outside a
 * LandingThemeProvider. Useful for shared components (e.g. Navigation)
 * that render on pages both with and without the provider.
 */
export function useLandingThemeOptional(): LandingThemeContextValue | null {
  return useContext(LandingThemeContext);
}
