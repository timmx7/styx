/**
 * Tests for lib/api.ts — API client with Supabase session auth.
 *
 * The request() helper gets the Supabase session access_token and sends
 * it as a Bearer header. On 401, it attempts supabase.auth.refreshSession()
 * and retries. On final failure, redirects to /login.
 *
 * Covers:
 *  - request() helper: Bearer token injection, 401 refresh flow, error handling
 *  - Individual API functions: getMe, getTeams, etc.
 *  - 204 No Content handling
 */

// ─── Mock Supabase client ────────────────────────────────────

const mockGetSession = jest.fn();
const mockRefreshSession = jest.fn();

jest.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: mockGetSession,
      refreshSession: mockRefreshSession,
    },
  }),
}));

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

import {
  getMe,
  getTeams,
  createTeam,
  getProjects,
  createProject,
  getApiKeys,
  createApiKey,
  revokeApiKey,
  getPlans,
  getBillingOverview,
  changePlan,
  getBudgets,
  getAlerts,
  markAlertRead,
  markAllAlertsRead,
  getAnalyticsOverview,
  getAnalyticsByProvider,
  getAnalyticsByDay,
  getAnalyticsByModel,
  getRoutingLogs,
} from "../api";

// ─── Helpers ─────────────────────────────────────────────────

function mockJsonResponse(data: any, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  });
}

function mock204Response() {
  return Promise.resolve({
    ok: true,
    status: 204,
    json: () => Promise.reject(new Error("No content")),
  });
}

function mockErrorResponse(status: number, detail: string) {
  return Promise.resolve({
    ok: false,
    status,
    json: () => Promise.resolve({ detail }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default: authenticated with a session
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: "test-supabase-token" } },
  });
  mockRefreshSession.mockResolvedValue({
    data: { session: null },
  });
});

// ═══════════════════════════════════════════════════════════════
//  request() — core helper
// ═══════════════════════════════════════════════════════════════

describe("request() — core behavior", () => {
  it("sends requests with credentials: include and Bearer token", async () => {
    mockFetch.mockReturnValueOnce(mockJsonResponse({ id: "u1" }));

    await getMe();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/auth/me"),
      expect.objectContaining({
        credentials: "include",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "Authorization": "Bearer test-supabase-token",
        }),
      })
    );
  });

  it("sends request without Authorization when no session", async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null } });
    mockFetch.mockReturnValueOnce(mockJsonResponse([]));

    await getPlans();

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers.Authorization).toBeUndefined();
  });

  it("handles 204 No Content", async () => {
    mockFetch.mockReturnValueOnce(mock204Response());

    const result = await revokeApiKey("key-1");
    expect(result).toBeUndefined();
  });

  it("throws on non-ok response with detail message", async () => {
    mockFetch.mockReturnValueOnce(mockErrorResponse(400, "Invalid input"));

    await expect(getMe()).rejects.toThrow("Invalid input");
  });

  it("throws generic message when response has no detail", async () => {
    mockFetch.mockReturnValueOnce(
      Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error("parse error")),
      })
    );

    await expect(getMe()).rejects.toThrow("Request failed: 500");
  });
});

// ═══════════════════════════════════════════════════════════════
//  401 — Supabase refresh flow
// ═══════════════════════════════════════════════════════════════

describe("request() — 401 Supabase refresh flow", () => {
  it("attempts Supabase session refresh and retries on 401", async () => {
    // First call: 401
    mockFetch.mockReturnValueOnce(
      Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) })
    );

    // After refresh, retry succeeds
    mockRefreshSession.mockResolvedValueOnce({
      data: { session: { access_token: "refreshed-token" } },
    });

    mockFetch.mockReturnValueOnce(
      mockJsonResponse({ id: "u1", email: "test@test.com" })
    );

    const user = await getMe();

    expect(mockRefreshSession).toHaveBeenCalledTimes(1);
    expect(user).toEqual({ id: "u1", email: "test@test.com" });
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Verify retry used refreshed token
    const retryHeaders = mockFetch.mock.calls[1][1].headers;
    expect(retryHeaders.Authorization).toBe("Bearer refreshed-token");
  });

  it("throws Unauthorized when refresh returns no session", async () => {
    // 401 on original request
    mockFetch.mockReturnValueOnce(
      Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) })
    );

    // Refresh returns no session
    mockRefreshSession.mockResolvedValueOnce({
      data: { session: null },
    });

    await expect(getMe()).rejects.toThrow("Unauthorized");
  });
});

// ═══════════════════════════════════════════════════════════════
//  Auth endpoints
// ═══════════════════════════════════════════════════════════════

describe("Auth API", () => {
  it("getMe fetches /api/auth/me", async () => {
    mockFetch.mockReturnValueOnce(
      mockJsonResponse({ id: "u1", email: "test@test.com" })
    );

    const user = await getMe();

    expect(user.id).toBe("u1");
    expect(mockFetch.mock.calls[0][0]).toContain("/api/auth/me");
  });
});

// ═══════════════════════════════════════════════════════════════
//  Teams & Projects
// ═══════════════════════════════════════════════════════════════

describe("Teams API", () => {
  it("getTeams fetches /api/teams", async () => {
    mockFetch.mockReturnValueOnce(mockJsonResponse([{ id: "t1", name: "Team 1" }]));
    const teams = await getTeams();
    expect(teams).toHaveLength(1);
    expect(mockFetch.mock.calls[0][0]).toContain("/api/teams");
  });

  it("createTeam posts name", async () => {
    mockFetch.mockReturnValueOnce(mockJsonResponse({ id: "t1", name: "New Team" }));
    const team = await createTeam("New Team");
    expect(team.name).toBe("New Team");
    expect(mockFetch.mock.calls[0][1].method).toBe("POST");
  });
});

describe("Projects API", () => {
  it("getProjects fetches /api/projects", async () => {
    mockFetch.mockReturnValueOnce(mockJsonResponse([{ id: "p1" }]));
    const projects = await getProjects();
    expect(projects).toHaveLength(1);
  });

  it("createProject posts project data", async () => {
    mockFetch.mockReturnValueOnce(mockJsonResponse({ id: "p1", name: "Proj" }));
    await createProject({ name: "Proj", team_id: "t1", budget_monthly_cents: 5000 });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.budget_monthly_cents).toBe(5000);
  });
});

// ═══════════════════════════════════════════════════════════════
//  API Keys
// ═══════════════════════════════════════════════════════════════

describe("API Keys", () => {
  it("getApiKeys without projectId fetches all", async () => {
    mockFetch.mockReturnValueOnce(mockJsonResponse([]));
    await getApiKeys();
    expect(mockFetch.mock.calls[0][0]).toContain("/api/keys");
    expect(mockFetch.mock.calls[0][0]).not.toContain("project_id");
  });

  it("getApiKeys with projectId adds query param", async () => {
    mockFetch.mockReturnValueOnce(mockJsonResponse([]));
    await getApiKeys("p1");
    expect(mockFetch.mock.calls[0][0]).toContain("project_id=p1");
  });

  it("createApiKey posts key data", async () => {
    mockFetch.mockReturnValueOnce(
      mockJsonResponse({ id: "k1", key: "sk_styx_test" })
    );
    const key = await createApiKey({ project_id: "p1", name: "prod" });
    expect(key.key).toBe("sk_styx_test");
  });

  it("revokeApiKey sends DELETE", async () => {
    mockFetch.mockReturnValueOnce(mock204Response());
    await revokeApiKey("k1");
    expect(mockFetch.mock.calls[0][1].method).toBe("DELETE");
    expect(mockFetch.mock.calls[0][0]).toContain("/api/keys/k1");
  });
});

// ═══════════════════════════════════════════════════════════════
//  Billing & Budget
// ═══════════════════════════════════════════════════════════════

describe("Billing API", () => {
  it("getPlans fetches /api/billing/plans", async () => {
    mockFetch.mockReturnValueOnce(mockJsonResponse([{ name: "Starter" }]));
    const plans = await getPlans();
    expect(plans).toHaveLength(1);
  });

  it("getBillingOverview fetches overview", async () => {
    mockFetch.mockReturnValueOnce(
      mockJsonResponse({ team_id: "t1", current_plan: "shade" })
    );
    const overview = await getBillingOverview();
    expect(overview.team_id).toBe("t1");
  });

  it("changePlan posts plan name", async () => {
    mockFetch.mockReturnValueOnce(mockJsonResponse({ ok: true, plan: "obol" }));
    const res = await changePlan("obol");
    expect(res.plan).toBe("obol");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.plan).toBe("obol");
  });
});

describe("Budget API", () => {
  it("getBudgets fetches /api/budget", async () => {
    mockFetch.mockReturnValueOnce(mockJsonResponse([]));
    await getBudgets();
    expect(mockFetch.mock.calls[0][0]).toContain("/api/budget");
  });
});

// ═══════════════════════════════════════════════════════════════
//  Alerts
// ═══════════════════════════════════════════════════════════════

describe("Alerts API", () => {
  it("getAlerts with defaults", async () => {
    mockFetch.mockReturnValueOnce(mockJsonResponse([]));
    await getAlerts();
    expect(mockFetch.mock.calls[0][0]).toContain("limit=50");
    expect(mockFetch.mock.calls[0][0]).not.toContain("unread_only");
  });

  it("getAlerts with unreadOnly", async () => {
    mockFetch.mockReturnValueOnce(mockJsonResponse([]));
    await getAlerts(100, true);
    expect(mockFetch.mock.calls[0][0]).toContain("limit=100");
    expect(mockFetch.mock.calls[0][0]).toContain("unread_only=true");
  });

  it("markAlertRead posts to correct URL", async () => {
    mockFetch.mockReturnValueOnce(mockJsonResponse({ ok: true }));
    await markAlertRead("alert-123");
    expect(mockFetch.mock.calls[0][0]).toContain("/api/alerts/alert-123/read");
    expect(mockFetch.mock.calls[0][1].method).toBe("POST");
  });

  it("markAllAlertsRead posts to mark-all-read", async () => {
    mockFetch.mockReturnValueOnce(mockJsonResponse({ marked_read: 5 }));
    const res = await markAllAlertsRead();
    expect(res.marked_read).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════════
//  Analytics
// ═══════════════════════════════════════════════════════════════

describe("Analytics API", () => {
  it("getAnalyticsOverview uses default 30 days", async () => {
    mockFetch.mockReturnValueOnce(
      mockJsonResponse({ total_requests: 100, period_days: 30 })
    );
    await getAnalyticsOverview();
    expect(mockFetch.mock.calls[0][0]).toContain("days=30");
  });

  it("getAnalyticsOverview accepts custom days", async () => {
    mockFetch.mockReturnValueOnce(mockJsonResponse({ total_requests: 50 }));
    await getAnalyticsOverview(7);
    expect(mockFetch.mock.calls[0][0]).toContain("days=7");
  });

  it("getAnalyticsByProvider fetches by-provider", async () => {
    mockFetch.mockReturnValueOnce(mockJsonResponse([]));
    await getAnalyticsByProvider(14);
    expect(mockFetch.mock.calls[0][0]).toContain("/by-provider?days=14");
  });

  it("getAnalyticsByDay fetches by-day", async () => {
    mockFetch.mockReturnValueOnce(mockJsonResponse([]));
    await getAnalyticsByDay();
    expect(mockFetch.mock.calls[0][0]).toContain("/by-day?days=30");
  });

  it("getAnalyticsByModel fetches by-model", async () => {
    mockFetch.mockReturnValueOnce(mockJsonResponse([]));
    await getAnalyticsByModel(60);
    expect(mockFetch.mock.calls[0][0]).toContain("/by-model?days=60");
  });
});

// ═══════════════════════════════════════════════════════════════
//  Routing Logs
// ═══════════════════════════════════════════════════════════════

describe("Routing Logs API", () => {
  it("getRoutingLogs with defaults", async () => {
    mockFetch.mockReturnValueOnce(mockJsonResponse([]));
    await getRoutingLogs();
    expect(mockFetch.mock.calls[0][0]).toContain("limit=50");
  });

  it("getRoutingLogs with projectId", async () => {
    mockFetch.mockReturnValueOnce(mockJsonResponse([]));
    await getRoutingLogs(20, "p1");
    expect(mockFetch.mock.calls[0][0]).toContain("limit=20");
    expect(mockFetch.mock.calls[0][0]).toContain("project_id=p1");
  });
});
