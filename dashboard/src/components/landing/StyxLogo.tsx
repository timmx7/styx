"use client";

interface StyxLogoProps {
  size?: "sm" | "lg";
}

export function StyxLogo({ size = "sm" }: StyxLogoProps) {
  const fontSize = size === "lg" ? "64px" : "18px";
  const letterSpacing = size === "lg" ? "8px" : "4px";

  return (
    <span
      className="font-serif font-semibold uppercase select-none"
      style={{ fontSize, letterSpacing, lineHeight: 1 }}
    >
      <span className="text-foreground">STY</span>
      <span className="text-primary">X</span>
    </span>
  );
}
