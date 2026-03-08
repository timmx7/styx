import { createClient } from "@/lib/supabase/client";
import type {
  Alert,
  AnalyticsOverview,
  ApiKey,
  ApiKeyCreated,
  BillingOverview,
  BudgetStatus,
  CreditBalance,
  CreditTransaction,
  DailyStats,
  ModelPricing,
  ModelStats,
  PlanInfo,
  Project,
  ProviderStats,
  RoutingLog,
  TraceLog,
  Subscription,
  Team,
  TeamMember,
  User,
  PromptCreate,
  PromptTemplate,
  PromptUpdate,
  EndUserAnalytics,
  IdentityProvider,
  IdentityProviderUpdate,
  ABTestExperiment,
  ABTestExperimentCreate,
  ABTestExperimentUpdate,
  WebhookEndpoint,
  WebhookEndpointCreate,
  WebhookEndpointUpdate,
  WebhookDelivery,
} from "./types";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === "true";

// ─── Generic fetch helper ───────────────────────────────────────

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  // In production mode, attach Supabase session token
  if (!SKIP_AUTH) {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers["Authorization"] = `Bearer ${session.access_token}`;
    }
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  if (res.status === 401 && !SKIP_AUTH) {
    // Try refreshing the Supabase session
    const supabase = createClient();
    const { data: { session: refreshedSession } } = await supabase.auth.refreshSession();
    if (refreshedSession?.access_token) {
      headers["Authorization"] = `Bearer ${refreshedSession.access_token}`;
      const retryRes = await fetch(`${API_BASE}${path}`, { ...options, headers, credentials: "include" });
      if (retryRes.ok) {
        if (retryRes.status === 204) return undefined as T;
        return retryRes.json();
      }
    }
    // Session refresh failed — redirect to login, preserving return path
    if (typeof window !== "undefined") {
      const returnPath = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/login?returnTo=${returnPath}`;
    }
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed: ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

// ─── Auth ───────────────────────────────────────────────────────

export async function getMe(): Promise<User> {
  return request<User>("/api/auth/me");
}

// ─── Teams ──────────────────────────────────────────────────────

export async function getTeams(): Promise<Team[]> {
  return request<Team[]>("/api/teams");
}

export async function createTeam(name: string): Promise<Team> {
  return request<Team>("/api/teams", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function getTeam(): Promise<Team | undefined> {
  const teams = await request<Team[]>("/api/teams");
  return teams?.[0];
}

export async function updateTeam(
  teamId: string,
  data: { name: string }
): Promise<Team> {
  return request<Team>(`/api/teams/${teamId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function getTeamMembers(teamId: string): Promise<TeamMember[]> {
  return request<TeamMember[]>(`/api/teams/${teamId}/members`);
}

export async function inviteTeamMember(teamId: string, data: { email: string; role: string }): Promise<{ message: string }> {
  return request<{ message: string }>(`/api/teams/${teamId}/invite`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function leaveTeam(teamId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/teams/${teamId}/leave`, {
    method: "POST",
  });
}

export async function deleteTeam(teamId: string): Promise<void> {
  return request<void>(`/api/teams/${teamId}`, {
    method: "DELETE",
  });
}

// ─── SSO Configuration ──────────────────────────────────────────

export async function getTeamSSOConfig(teamId: string): Promise<IdentityProvider | null> {
  try {
    return await request<IdentityProvider>(`/api/teams/${teamId}/sso`);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.toLowerCase().includes("not found")) {
      return null;
    }
    throw err;
  }
}

export async function updateTeamSSOConfig(teamId: string, data: IdentityProviderUpdate): Promise<IdentityProvider> {
  return request<IdentityProvider>(`/api/teams/${teamId}/sso`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteTeamSSOConfig(teamId: string): Promise<void> {
  return request<void>(`/api/teams/${teamId}/sso`, {
    method: "DELETE",
  });
}

// ─── Projects ───────────────────────────────────────────────────

export async function getProjects(): Promise<Project[]> {
  return request<Project[]>("/api/projects");
}

export async function getProject(projectId: string): Promise<Project> {
  return request<Project>(`/api/projects/${projectId}`);
}

export async function createProject(data: {
  name: string;
  team_id: string;
  budget_monthly_cents?: number | null;
  allowed_providers?: string[];
  routing_strategy?: string;
}): Promise<Project> {
  return request<Project>("/api/projects", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateProject(
  projectId: string,
  data: {
    name?: string | null;
    budget_monthly_cents?: number | null;
    budget_alert_threshold_pct?: number | null;
    allowed_providers?: string[] | null;
    routing_strategy?: string | null;
    pii_redaction_enabled?: boolean | null;
    guardrails_config?: Record<string, unknown> | null;
    semantic_cache_enabled?: boolean | null;
    end_user_rate_limit?: number | null;
  }
): Promise<Project> {
  return request<Project>(`/api/projects/${projectId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

// ─── Project Members ───────────────────────────────────────────────────

export interface ProjectMember {
  id: string;
  project_id: string;
  user_id: string;
  role: string;
  user_email: string | null;
  user_name: string | null;
  created_at: string;
}

export async function getProjectMembers(projectId: string): Promise<ProjectMember[]> {
  return request<ProjectMember[]>(`/api/projects/${projectId}/members`);
}

export async function addProjectMember(
  projectId: string,
  userId: string,
  role: string
): Promise<ProjectMember> {
  return request<ProjectMember>(`/api/projects/${projectId}/members`, {
    method: "POST",
    body: JSON.stringify({ user_id: userId, role }),
  });
}

export async function removeProjectMember(projectId: string, userId: string): Promise<void> {
  return request<void>(`/api/projects/${projectId}/members/${userId}`, {
    method: "DELETE",
  });
}

// ─── API Keys ───────────────────────────────────────────────────

export async function getApiKeys(projectId?: string): Promise<ApiKey[]> {
  const query = projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
  return request<ApiKey[]>(`/api/keys${query}`);
}

export async function createApiKey(data: {
  project_id: string;
  name?: string;
  rate_limit_per_minute?: number;
}): Promise<ApiKeyCreated> {
  return request<ApiKeyCreated>("/api/keys", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function revokeApiKey(keyId: string): Promise<void> {
  return request<void>(`/api/keys/${keyId}`, { method: "DELETE" });
}

// ─── Routing Logs ──────────────────────────────────────────────

export async function getRoutingLogs(
  limit: number = 50,
  projectId?: string
): Promise<RoutingLog[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (projectId) params.set("project_id", projectId);
  return request<RoutingLog[]>(`/api/analytics/routing-logs?${params}`);
}

export async function getProjectTraces(
  projectId: string,
  limit: number = 50
): Promise<TraceLog[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  return request<TraceLog[]>(`/api/analytics/projects/${projectId}/traces?${params}`);
}

// ─── Billing ───────────────────────────────────────────────────

export async function getPlans(): Promise<PlanInfo[]> {
  return request<PlanInfo[]>("/api/billing/plans");
}

export async function getBillingOverview(): Promise<BillingOverview> {
  return request<BillingOverview>("/api/billing/overview");
}

export async function changePlan(planName: string): Promise<{ ok: boolean; plan: string }> {
  return request("/api/billing/change-plan", {
    method: "POST",
    body: JSON.stringify({ plan: planName }),
  });
}

// ─── Billing Mode ──────────────────────────────────────────────

export async function setBillingMode(mode: "charon" | "achilles"): Promise<User> {
  return request<User>("/api/auth/me", {
    method: "PATCH",
    body: JSON.stringify({ billing_mode: mode }),
  });
}

export async function getSubscription(): Promise<Subscription> {
  return request<Subscription>("/api/billing/subscription");
}

export async function createCheckoutSession(
  billingMode: string,
  plan: string
): Promise<{ url: string }> {
  return request<{ url: string }>("/api/billing/create-checkout", {
    method: "POST",
    body: JSON.stringify({ billing_mode: billingMode, plan }),
  });
}

export async function createPortalSession(): Promise<{ url: string }> {
  return request<{ url: string }>("/api/billing/create-portal", {
    method: "POST",
  });
}

// ─── Credits (Achilles) ────────────────────────────────────────

export async function getCreditBalance(): Promise<CreditBalance> {
  return request<CreditBalance>("/api/credits/balance");
}

export async function purchaseCredits(amountCents: number): Promise<{ url: string }> {
  return request<{ url: string }>("/api/credits/purchase", {
    method: "POST",
    body: JSON.stringify({ amount_cents: amountCents }),
  });
}

export async function getCreditTransactions(
  limit: number = 50
): Promise<CreditTransaction[]> {
  return request<CreditTransaction[]>(`/api/credits/transactions?limit=${limit}`);
}

// ─── Model Pricing ─────────────────────────────────────────────

export async function getModelPricing(): Promise<ModelPricing[]> {
  return request<ModelPricing[]>("/api/pricing/models");
}

// ─── Budget ────────────────────────────────────────────────────

export async function getBudgets(): Promise<BudgetStatus[]> {
  return request<BudgetStatus[]>("/api/budget");
}

export async function updateBudget(
  projectId: string,
  data: { budget_monthly_cents?: number | null; alert_threshold_pct?: number }
): Promise<{ ok: boolean }> {
  return request(`/api/budget/${projectId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

// ─── Alerts ────────────────────────────────────────────────────

export async function getAlerts(
  limit: number = 50,
  unreadOnly: boolean = false
): Promise<Alert[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (unreadOnly) params.set("unread_only", "true");
  return request<Alert[]>(`/api/alerts?${params}`);
}

export async function markAlertRead(alertId: string): Promise<{ ok: boolean }> {
  return request(`/api/alerts/${alertId}/read`, { method: "POST" });
}

export async function markAllAlertsRead(): Promise<{ marked_read: number }> {
  return request("/api/alerts/mark-all-read", { method: "POST" });
}

// ─── Analytics ─────────────────────────────────────────────────

export async function getAnalyticsOverview(
  days: number = 30
): Promise<AnalyticsOverview> {
  return request<AnalyticsOverview>(`/api/analytics/overview?days=${days}`);
}

export async function getAnalyticsByProvider(
  days: number = 30
): Promise<ProviderStats[]> {
  return request<ProviderStats[]>(`/api/analytics/by-provider?days=${days}`);
}

export async function getAnalyticsByDay(
  days: number = 30
): Promise<DailyStats[]> {
  return request<DailyStats[]>(`/api/analytics/by-day?days=${days}`);
}

export async function getAnalyticsByModel(
  days: number = 30
): Promise<ModelStats[]> {
  return request<ModelStats[]>(`/api/analytics/by-model?days=${days}`);
}

export async function getAnalyticsEndUsers(
  projectId: string,
  days: number = 30
): Promise<EndUserAnalytics[]> {
  return request<EndUserAnalytics[]>(`/api/projects/${projectId}/end-users?period=${days}d`);
}

// ─── Prompts ────────────────────────────────────────────────────

export async function getPrompts(projectId: string): Promise<PromptTemplate[]> {
  return request<PromptTemplate[]>(`/api/projects/${projectId}/prompts`);
}

export async function createPrompt(projectId: string, data: PromptCreate): Promise<PromptTemplate> {
  return request<PromptTemplate>(`/api/projects/${projectId}/prompts`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updatePrompt(
  projectId: string,
  promptId: string,
  data: PromptUpdate
): Promise<PromptTemplate> {
  return request<PromptTemplate>(`/api/projects/${projectId}/prompts/${promptId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deletePrompt(projectId: string, promptId: string): Promise<void> {
  return request<void>(`/api/projects/${projectId}/prompts/${promptId}`, {
    method: "DELETE",
  });
}

export async function deleteIdentityProvider(teamId: string, providerId: string): Promise<void> {
  return request<void>(`/api/teams/${teamId}/sso/providers/${providerId}`, {
    method: "DELETE",
  });
}

// ─── A/B Testing Evals ──────────────────────────────────────────

export async function getABTests(projectId: string): Promise<ABTestExperiment[]> {
  return request<ABTestExperiment[]>(`/api/projects/${projectId}/ab-tests`);
}

export async function createABTest(
  projectId: string,
  data: ABTestExperimentCreate
): Promise<ABTestExperiment> {
  return request<ABTestExperiment>(`/api/projects/${projectId}/ab-tests`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateABTest(
  projectId: string,
  experimentId: string,
  data: ABTestExperimentUpdate
): Promise<ABTestExperiment> {
  return request<ABTestExperiment>(`/api/projects/${projectId}/ab-tests/${experimentId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteABTest(projectId: string, experimentId: string): Promise<void> {
  return request<void>(`/api/projects/${projectId}/ab-tests/${experimentId}`, {
    method: "DELETE",
  });
}

// ─── Datasets ───────────────────────────────────────────────────

export async function downloadDataset(projectId: string): Promise<void> {
  const headers: Record<string, string> = {};

  // Attach auth token in production mode
  if (!SKIP_AUTH) {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers["Authorization"] = `Bearer ${session.access_token}`;
    }
  }

  const res = await fetch(`${API_BASE}/api/projects/${projectId}/export-dataset`, {
    credentials: "include",
    headers,
  });
  if (!res.ok) throw new Error("Failed to download dataset");

  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  // Try to use backend-provided filename if possible, otherwise fallback
  const contentDisposition = res.headers.get("Content-Disposition");
  let filename = `dataset_${projectId}.jsonl`;
  if (contentDisposition) {
    const match = contentDisposition.match(/filename="?([^"]+)"?/);
    if (match && match[1]) filename = match[1];
  }
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

// ─── Webhooks ───────────────────────────────────────────────────

export async function getWebhooks(): Promise<WebhookEndpoint[]> {
  return request<WebhookEndpoint[]>("/api/webhooks");
}

export async function createWebhook(data: WebhookEndpointCreate): Promise<WebhookEndpoint> {
  return request<WebhookEndpoint>("/api/webhooks", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getWebhook(webhookId: string): Promise<WebhookEndpoint> {
  return request<WebhookEndpoint>(`/api/webhooks/${webhookId}`);
}

export async function updateWebhook(
  webhookId: string,
  data: WebhookEndpointUpdate
): Promise<WebhookEndpoint> {
  return request<WebhookEndpoint>(`/api/webhooks/${webhookId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteWebhook(webhookId: string): Promise<void> {
  return request<void>(`/api/webhooks/${webhookId}`, {
    method: "DELETE",
  });
}

export async function testWebhook(webhookId: string): Promise<{ message: string }> {
  return request<{ message: string }>(`/api/webhooks/${webhookId}/test`, {
    method: "POST",
  });
}

export async function getWebhookDeliveries(
  webhookId: string,
  limit: number = 50
): Promise<WebhookDelivery[]> {
  return request<WebhookDelivery[]>(`/api/webhooks/${webhookId}/deliveries?limit=${limit}`);
}
