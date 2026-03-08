# Architecture Reference

Detailed technical reference for the Styx AI gateway.

## System Overview

```
                    Internet
                       |
                    [Nginx :80/:443]
                    HTTPS termination
                   /       |        \
                  /        |         \
    [Dashboard :3000]  [Router :8080]  [Backend :8000]
     Next.js UI        Go proxy         FastAPI
                          |                |
                    +-----+-----+     [PostgreSQL]
                    |     |     |     [Redis]
              [Cache]  [Classify]  [ClickHouse]
              :8002    :8001
                |
            [Qdrant :6333]
```

## Services

### Go Router (`:8080`) — Critical Path

The performance-critical reverse proxy. All AI requests flow through here.

**Responsibilities:**
- API key validation (calls backend `/internal/validate-key`)
- Billing enforcement (Charon quota check, Achilles balance check)
- Request routing based on model name and classifier hints
- Provider-specific request/response translation
- SSE streaming passthrough
- Circuit breaker + automatic failover
- Rate limiting (token bucket + Redis)
- Prometheus metrics export

**Key files:**
- `cmd/server/main.go` — Entry point, HTTP server setup
- `internal/proxy/handler.go` — Main request handler, pre/post billing hooks
- `internal/proxy/streaming.go` — SSE chunked response handling
- `internal/router/router.go` — Provider selection logic
- `internal/fallback/circuitbreaker.go` — Per-provider circuit breaker
- `internal/providers/*.go` — Provider adapters (OpenAI, Anthropic, Google, Mistral, Azure)
- `internal/auth/validator.go` — Key validation against backend

**Performance target:** <10ms overhead on a proxied request.

### Python Backend (`:8000`) — Business Logic

All non-performance-critical logic: auth, billing, analytics, team management.

**Framework:** FastAPI with async SQLAlchemy 2.0

**API routers (14):**
- `auth.py` — Register, login, JWT, OAuth, SSO, password reset
- `projects.py` — CRUD projects and members
- `keys.py` — API key generation and revocation
- `billing.py` — Stripe subscriptions, checkout, webhook
- `credits.py` — Achilles credit balance and purchases
- `pricing.py` — Model pricing (public endpoint)
- `budget.py` — Per-project budget limits
- `alerts.py` — Notification management
- `analytics.py` — Usage stats, traces, exports
- `teams.py` — Team management, invitations, SSO config
- `provider_keys.py` — Encrypted BYOK key storage
- `webhooks.py` — Outbound webhook management
- `ab_tests.py` — A/B testing experiments
- `internal.py` — Docker-internal endpoints (key validation, billing deductions)

**Services:**
- `billing_service.py` — Stripe customer/subscription operations
- `credit_service.py` — Credit balance management (Redis + DB)
- `budget_service.py` — Redis-based spend tracking with Lua scripts
- `alert_service.py` — Alert creation, email/Slack delivery
- `pricing_service.py` — Model cost computation with markup

### Dashboard (`:3000`) — Web UI

**Framework:** Next.js 14 (App Router) + TypeScript + Tailwind CSS

**Pages:**
- `/` — Overview dashboard
- `/analytics` — Usage charts (Recharts)
- `/projects` — Project management
- `/keys` — API key management
- `/billing` — Charon/Achilles billing page
- `/routing` — Routing rules and logs
- `/alerts` — Alert center
- `/logs` — Request logs
- `/onboarding` — Charon vs Achilles selection

**Key patterns:**
- All API calls centralized in `src/lib/api.ts`
- Types shared via `src/lib/types.ts`
- Responsive: mobile hamburger sidebar, desktop fixed sidebar
- Sentry integration for error monitoring

### Classifier (`:8001`)

ML-based request classifier using scikit-learn. Categorizes incoming requests by complexity to inform routing decisions.

### Cache Service (`:8002`)

Semantic cache using Qdrant vector database. Embeds request text with `all-MiniLM-L6-v2` and returns cached responses for similarity > 0.98.

## Data Stores

### PostgreSQL 16

Primary durable storage for all business data.

**Key tables:**
- `users` — Accounts, auth, billing_mode
- `teams`, `team_members`, `team_invitations` — Team hierarchy
- `projects` — Projects under teams
- `api_keys` — HMAC-hashed API keys
- `provider_keys` — Fernet-encrypted BYOK keys
- `subscriptions` — Stripe subscription state, quota tracking
- `credit_balances` — Achilles credit ledger
- `credit_transactions` — Credit audit trail
- `model_pricing` — Per-model input/output costs
- `sso_configurations` — SAML SSO per team domain

**Migrations:** Alembic (auto-run on backend startup).

### Redis 7

Real-time counters, caching, and coordination.

**Key patterns:**
- `quota:{user_id}:monthly:{YYYY-MM}` — Charon request counter
- `ratelimit:{key_id}:{window}` — Token bucket counters
- `lockout:{email}` — Account lockout failure counter
- `webhook:{event_id}` — Webhook idempotency dedup (24h TTL)
- Budget spend counters — Lua scripts for atomic increment + threshold check

### ClickHouse

High-speed analytics for time-series usage data.

**Key table:** `request_logs` — Every proxied request with provider, model, tokens, latency, cost, cache hit.

### Qdrant

Vector database for semantic cache embeddings. Collections are partitioned by project for isolation.

## Authentication Flow

```
Register/Login → JWT (access_token + refresh_token)
                    |
                access_token → All /api/* endpoints
                    |
                    expires → POST /api/auth/refresh
```

**Additional auth methods:**
- GitHub OAuth (`/api/auth/github`)
- SAML SSO (`/api/auth/sso/login`)

**Security measures:**
- Account lockout: 10 failed attempts = 15-minute lock (Redis counter)
- API keys: HMAC-hashed in DB, prefix `sk_styx_` for identification
- Provider keys: Fernet-encrypted at rest
- CORS: Configurable allowed origins
- CSP: Strict Content-Security-Policy headers

## Billing Architecture

```
User chooses billing_mode (one-time)
         |
    +---------+-----------+
    |                     |
  Charon (BYOK)      Achilles (Managed)
    |                     |
  Plans:               Plans:
  Shade (free)         Spark ($10)
  Obol ($29)           Blaze ($50)
  Ferryman ($99)       Inferno ($200)
  Titan ($499)            |
    |                  Credits:
  Quota:               balance_cents
  requests_limit       deducted per request
  requests_used        based on token count
    |                     |
  Enforcement:         Enforcement:
  429 at limit         402 at zero balance
```

**Stripe flow:**
1. `create-checkout` → Stripe Checkout Session
2. User pays on Stripe-hosted page
3. Webhook → activate subscription / add credits
4. Customer Portal for self-service management

## Internal Communication

```
Router → Backend: HTTP (Docker network)
  POST /internal/validate-key     (pre-request)
  POST /internal/increment-request (post-request, Charon)
  POST /internal/deduct-credits    (post-request, Achilles)

Router → Cache Service: HTTP
  POST /check  (pre-routing)
  POST /store  (post-response)

Router → Classifier: HTTP
  POST /classify (pre-routing)
```

All internal endpoints require `X-Internal-Secret` header.

## Monitoring Stack

- **Prometheus** (`:9090`) — Scrapes Go router metrics on `/metrics`
- **Grafana** (`:3001`) — 3 pre-built dashboards (Overview, Providers, Infrastructure)
- **Sentry** — Error tracking for both backend and dashboard
- **ClickHouse** — Analytics queries for the dashboard charts

## Deployment Options

| Method | Config | Best for |
|--------|--------|----------|
| Docker Compose | `docker-compose.yml` | Development, small deployments |
| Kubernetes (Helm) | `infra/helm/styx/` | Production, autoscaling |
| K6 load tests | `infra/k6/` | Performance validation |
