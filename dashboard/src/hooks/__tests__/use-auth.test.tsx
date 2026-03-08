import { renderHook, act, waitFor } from "@testing-library/react";
import { useAuth } from "../use-auth";

// ─── Mocks ─────────────────────────────────────────────────────────

const mockPush = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: jest.fn(),
    back: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => "/overview",
  useSearchParams: () => new URLSearchParams(),
}));

const mockGetSession = jest.fn();
const mockSignOut = jest.fn().mockResolvedValue({});
const mockOnAuthStateChange = jest.fn();

jest.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: mockGetSession,
      signOut: mockSignOut,
      onAuthStateChange: mockOnAuthStateChange,
    },
  }),
}));

jest.mock("@/lib/api", () => ({
  getMe: jest.fn(),
}));

import { getMe } from "@/lib/api";
const mockGetMe = getMe as jest.MockedFunction<typeof getMe>;

// ─── Test data ─────────────────────────────────────────────────────

const fakeUser = {
  id: "user-1",
  email: "test@example.com",
  name: "Test User",
  role: "admin",
  billing_mode: null,
  created_at: "2025-01-01T00:00:00Z",
};

// ─── Helpers ────────────────────────────────────────────────────────

function setupAuthMock(hasSession: boolean) {
  const unsubscribe = jest.fn();
  mockOnAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe } },
  });

  if (hasSession) {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "test-token" } },
    });
  } else {
    mockGetSession.mockResolvedValue({
      data: { session: null },
    });
  }

  return { unsubscribe };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe("useAuth", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetMe.mockResolvedValue(fakeUser);
  });

  // 1. Initial state
  it("has initial state: loading=true, user=null, isAuthenticated=false", () => {
    setupAuthMock(false);

    const { result } = renderHook(() => useAuth());

    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  // 2. Loads user when session exists
  it("loads user when Supabase session exists and getMe resolves", async () => {
    setupAuthMock(true);
    mockGetMe.mockResolvedValue(fakeUser);

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.user).toEqual(fakeUser);
    });

    expect(mockGetMe).toHaveBeenCalledTimes(1);
  });

  // 3. Sets loading=false after user is loaded
  it("sets loading to false after user is loaded", async () => {
    setupAuthMock(true);
    mockGetMe.mockResolvedValue(fakeUser);

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.user).toEqual(fakeUser);
  });

  // 4. Sets loading=false when no session
  it("sets loading to false when no Supabase session", async () => {
    setupAuthMock(false);

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.user).toBeNull();
    expect(mockGetMe).not.toHaveBeenCalled();
  });

  // 5. Sets user to null when getMe fails
  it("sets user to null when getMe rejects", async () => {
    setupAuthMock(true);
    mockGetMe.mockRejectedValue(new Error("Unauthorized"));

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.user).toBeNull();
  });

  // 6. loginUser: fetches user, navigates to /overview
  it("loginUser fetches user and navigates to /overview", async () => {
    setupAuthMock(false);
    mockGetMe.mockResolvedValue(fakeUser);

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      result.current.loginUser();
    });

    expect(mockGetMe).toHaveBeenCalled();

    await waitFor(() => {
      expect(result.current.user).toEqual(fakeUser);
    });

    expect(mockPush).toHaveBeenCalledWith("/overview");
  });

  // 7. logout: calls supabase.auth.signOut, clears user, navigates
  it("logout signs out via Supabase, clears user, and navigates to /login", async () => {
    setupAuthMock(true);
    mockGetMe.mockResolvedValue(fakeUser);

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.user).toEqual(fakeUser);
    });

    await act(async () => {
      await result.current.logout();
    });

    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(result.current.user).toBeNull();
    expect(mockPush).toHaveBeenCalledWith("/login");
  });

  // 8. isAuthenticated returns true when user is loaded
  it("returns isAuthenticated=true when user is loaded", async () => {
    setupAuthMock(true);
    mockGetMe.mockResolvedValue(fakeUser);

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
    });

    expect(result.current.user).toEqual(fakeUser);
  });

  // ─── Edge cases ────────────────────────────────────────────────

  it("does not call getMe when no session", async () => {
    setupAuthMock(false);

    renderHook(() => useAuth());

    await waitFor(() => {
      expect(mockGetMe).not.toHaveBeenCalled();
    });
  });

  it("sets loading to false even when getMe rejects", async () => {
    setupAuthMock(true);
    mockGetMe.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it("cleans up auth state subscription on unmount", () => {
    const { unsubscribe } = setupAuthMock(false);

    const { unmount } = renderHook(() => useAuth());
    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("isAuthenticated is false after logout even if user was loaded", async () => {
    setupAuthMock(true);
    mockGetMe.mockResolvedValue(fakeUser);

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
    });

    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });
});
