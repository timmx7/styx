"use client";

import { useLandingThemeOptional, type LandingTheme } from "./LandingThemeProvider";

const themes: { value: LandingTheme; color: string; label: string }[] = [
  { value: "dark", color: "#000000", label: "Dark theme" },
  { value: "light", color: "#FAF9F6", label: "Light theme" },
];

export function ThemeSelector() {
  const ctx = useLandingThemeOptional();

  // Don't render when outside a LandingThemeProvider (e.g. /docs, /pricing)
  if (!ctx) return null;

  const { theme, setTheme } = ctx;

  const ringColor = theme === "light" ? "#000000" : "#FFFFFF";

  return (
    <div
      role="radiogroup"
      aria-label="Theme selector"
      className="flex items-center gap-2"
    >
      {themes.map((t) => {
        const isActive = theme === t.value;
        return (
          <button
            key={t.value}
            role="radio"
            aria-checked={isActive}
            aria-label={t.label}
            onClick={() => setTheme(t.value)}
            className="rounded-full p-0 border-0 cursor-pointer"
            style={{
              width: 12,
              height: 12,
              backgroundColor: t.color,
              outline: isActive ? `2px solid ${ringColor}` : "2px solid transparent",
              outlineOffset: 2,
              transition: "all 200ms ease",
            }}
          />
        );
      })}
    </div>
  );
}
