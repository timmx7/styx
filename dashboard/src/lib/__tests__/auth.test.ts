/**
 * Tests for lib/auth.ts — Supabase session detection.
 *
 * After the Supabase Auth migration, auth.ts checks for Supabase
 * session cookies (sb-*-auth-token) and delegates sign-out to
 * the Supabase client.
 *
 * Covers:
 *  - getToken: detects Supabase session cookies
 *  - removeToken: calls supabase.auth.signOut()
 *  - isAuthenticated: derived from getToken
 */

const mockSignOut = jest.fn().mockResolvedValue({});

jest.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signOut: mockSignOut,
    },
  }),
}));

import { getToken, removeToken, isAuthenticated } from "../auth";

// ─── Cookie helpers for test setup ──────────────────────────────

function setCookie(name: string, value: string): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/`;
}

function clearAllCookies(): void {
  document.cookie.split(";").forEach((cookie) => {
    const name = cookie.split("=")[0].trim();
    if (name) {
      document.cookie = `${name}=; path=/; max-age=0`;
    }
  });
}

describe("auth — Supabase session detection", () => {
  beforeEach(() => {
    clearAllCookies();
    jest.clearAllMocks();
  });

  // ─── getToken ────────────────────────────────────────────────

  it("returns null when no Supabase session cookie is present", () => {
    expect(getToken()).toBeNull();
  });

  it("returns a truthy value when a Supabase auth cookie is set", () => {
    setCookie("sb-abc123-auth-token", "some-session-data");
    expect(getToken()).toBeTruthy();
  });

  it("does not detect unrelated cookies as session", () => {
    setCookie("styx_token", "old-token");
    setCookie("other_cookie", "value");
    expect(getToken()).toBeNull();
  });

  // ─── removeToken ─────────────────────────────────────────────

  it("calls supabase.auth.signOut()", async () => {
    await removeToken();
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it("does not throw if no session exists", async () => {
    await expect(removeToken()).resolves.toBeUndefined();
  });

  // ─── isAuthenticated ────────────────────────────────────────

  it("returns false when no Supabase session cookie is present", () => {
    expect(isAuthenticated()).toBe(false);
  });

  it("returns true when a Supabase auth cookie is present", () => {
    setCookie("sb-proj-auth-token", "session-data");
    expect(isAuthenticated()).toBe(true);
  });
});
