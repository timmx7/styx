// ─── User & Auth ────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  name: string | null;
  role: string;
  billing_mode: "charon" | "achilles" | null;
  created_at: string;
}

export interface TokenResponse {
  message: string;
}

// ─── Teams ──────────────────────────────────────────────────────

export interface Team {
  id: string;
  name: string;
  owner_id: string;
  plan: string;
  created_at: string;
}

export interface TeamMember {
  id: string;
  user_id: string;
  team_id: string;
  user_name: string | null;
  user_email: string | null;
  role: "owner" | "admin" | "member" | "developer" | "billing" | "viewer";
  created_at: string;
}

// ─── Projects ───────────────────────────────────────────────────

export interface Project {
  id: string;
  team_id: string;
  name: string;
  budget_monthly_cents: number | null;
  budget_alert_threshold_pct: number;
  allowed_providers: string[] | null;
  routing_strategy: string;
  pii_redaction_enabled: boolean;
  guardrails_config: Record<string, unknown> | null;
  semantic_cache_enabled: boolean;
  end_user_rate_limit: number;
  created_at: string;
}

// ─── API Keys ───────────────────────────────────────────────────

export interface ApiKey {
  id: string;
  project_id: string;
  key_prefix: string;
  name: string | null;
  rate_limit_per_minute: number;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
}

export interface ApiKeyCreated extends ApiKey {
  key: string; // plain key, shown only once
}

// ─── Routing Logs ──────────────────────────────────────────────

export interface RoutingLog {
  id: string;
  project_id: string;
  provider: string;
  model: string;
  complexity: string;
  latency_ms: number;
  status_code: number;
  cache_hit: boolean;
  was_fallback: boolean;
  input_tokens: number;
  output_tokens: number;
  cost_cents?: number;
  created_at: string;
}

// TraceLog is now identical to RoutingLog — bodies no longer logged for privacy
export type TraceLog = RoutingLog;

// ─── Overview Stats ─────────────────────────────────────────────

export interface OverviewStats {
  total_requests: number;
  total_projects: number;
  total_keys: number;
  active_keys: number;
}

// ─── Billing ────────────────────────────────────────────────────

export interface PlanInfo {
  name: string;
  display_name: string;
  price_cents: number;
  features: string[];
  request_limit: number | null;
  budget_limit_cents: number | null;
}

export interface InvoiceItem {
  id: string;
  amount_cents: number;
  currency: string;
  status: string;
  created_at: string;
  pdf_url: string | null;
}

export interface BillingOverview {
  team_id: string;
  team_name: string;
  current_plan: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_spend_cents: number;
  budget_cents: number | null;
  invoices: InvoiceItem[];
}

// ─── Budget ─────────────────────────────────────────────────────

export interface BudgetStatus {
  project_id: string;
  project_name: string;
  budget_cents: number | null;
  spent_cents: number;
  remaining_cents: number | null;
  pct_used: number;
  alert_threshold_pct: number;
}

// ─── Alerts ─────────────────────────────────────────────────────

export interface Alert {
  id: string;
  project_id: string | null;
  team_id: string;
  alert_type: string;
  severity: string;
  title: string;
  message: string;
  is_read: boolean;
  budget_cents: number | null;
  spent_cents: number | null;
  threshold_pct: number | null;
  created_at: string;
}

// ─── Subscription (Charon/Achilles) ─────────────────────────────

export interface Subscription {
  id: string;
  user_id: string;
  billing_mode: string;
  plan: string;
  status: string;
  requests_used: number;
  requests_limit: number;
  current_period_start: string | null;
  current_period_end: string | null;
  created_at: string;
}

export interface CreditBalance {
  balance_cents: number;
  total_purchased_cents: number;
  total_consumed_cents: number;
  updated_at: string;
}

export interface CreditTransaction {
  id: string;
  type: string;
  amount_cents: number;
  balance_after_cents: number;
  description: string | null;
  created_at: string;
}

export interface ModelPricing {
  provider: string;
  model: string;
  display_name: string;
  input_price_per_million: number;
  output_price_per_million: number;
  is_active: boolean;
}

// ─── Analytics ──────────────────────────────────────────────────

export interface AnalyticsOverview {
  total_requests: number;
  avg_latency_ms: number;
  cache_hit_rate: number;
  cache_hits: number;
  fallback_rate: number;
  error_rate: number;
  period_days: number;
}

export interface ProviderStats {
  provider: string;
  request_count: number;
  avg_latency_ms: number;
  error_count: number;
  error_rate: number;
}

export interface DailyStats {
  date: string;
  request_count: number;
  avg_latency_ms: number;
}

export interface ModelStats {
  model: string;
  provider: string;
  request_count: number;
  avg_latency_ms: number;
}

// ─── Prompts ────────────────────────────────────────────────────

export interface PromptTemplate {
  id: string;
  project_id: string;
  name: string;
  system_prompt: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface EndUserAnalytics {
  user_id: string;
  total_requests: number;
  total_cost: number;
  total_tokens: number;
  avg_latency: number;
  last_seen: string;
}

export interface PromptCreate {
  name: string;
  system_prompt: string;
  is_active: boolean;
}

export interface PromptUpdate {
  name?: string;
  system_prompt?: string;
  is_active?: boolean;
}

// ─── SSO Configuration ──────────────────────────────────────────

export interface IdentityProvider {
  id: string;
  team_id: string;
  provider_type: string;
  domain: string;
  config: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface IdentityProviderUpdate {
  provider_type?: "saml" | "oidc";
  domain?: string;
  config?: Record<string, unknown>;
  is_active?: boolean;
}

// ─── A/B Testing Evals ──────────────────────────────────────────

export interface ABTestVariant {
  id: string;
  provider: string;
  model: string;
  system_prompt?: string | null;
  weight: number;
}

export interface ABTestExperiment {
  id: string;
  project_id: string;
  name: string;
  is_active: boolean;
  variants: ABTestVariant[];
  created_at: string;
  updated_at: string;
}

export interface ABTestExperimentCreate {
  name: string;
  is_active?: boolean;
  variants: ABTestVariant[];
}

export interface ABTestExperimentUpdate {
  name?: string;
  is_active?: boolean;
  variants?: ABTestVariant[];
}

// ─── Webhooks ───────────────────────────────────────────────────

export interface WebhookEndpoint {
  id: string;
  team_id: string;
  url: string;
  secret?: string; // Only returned on creation
  events: string[];
  is_active: boolean;
  description?: string | null;
  last_triggered_at?: string | null;
  consecutive_failures: number;
  created_at: string;
}

export interface WebhookEndpointCreate {
  team_id: string;
  url: string;
  events: string[];
  description?: string | null;
}

export interface WebhookEndpointUpdate {
  url?: string;
  events?: string[];
  is_active?: boolean;
  description?: string | null;
}

export interface WebhookDelivery {
  id: string;
  endpoint_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  response_status?: number | null;
  response_body?: string | null;
  success: boolean;
  created_at: string;
}
