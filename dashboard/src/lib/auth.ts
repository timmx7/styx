const TOKEN_KEY = "styx_token";

// ─── Cookie helpers ─────────────────────────────────────────────
// Auth tokens are now HttpOnly cookies set by the backend.
// The only client-visible cookie is the non-sensitive `styx_token`
// presence flag used by middleware for redirect logic.

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const cookies = document.cookie.split("; ");
  for (const cookie of cookies) {
    const [key, ...rest] = cookie.split("=");
    if (key === name) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}

function deleteCookie(name: string): void {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax${secure}`;
}

// ─── Public API (same signatures as before) ─────────────────────

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return getCookie(TOKEN_KEY);
}

export function removeToken(): void {
  deleteCookie(TOKEN_KEY);
}

export function isAuthenticated(): boolean {
  return !!getToken();
}
