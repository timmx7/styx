# Self-Hosting Guide

Run your own Styx instance with Docker Compose or Kubernetes.

## Requirements

- Docker Engine 24+ and Docker Compose v2
- 4 GB RAM minimum (8 GB recommended)
- At least one AI provider API key (OpenAI, Anthropic, Google, or Mistral)

## Quick Start (Docker Compose)

### 1. Clone the Repository

```bash
git clone https://github.com/timmx7/styx.git
cd styx
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and set the required values:

```bash
# Required: Security keys (generate fresh values)
JWT_SECRET=$(openssl rand -hex 32)
INTERNAL_SECRET=$(openssl rand -hex 32)
API_KEY_HMAC_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")

# Required: At least one provider key
OPENAI_API_KEY=sk-your-key

# Required: Database passwords
POSTGRES_PASSWORD=change-this-in-production
REDIS_PASSWORD=change-this-in-production

# Optional: Stripe (for billing features)
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
```

### 3. Start All Services

```bash
docker compose up -d
```

This starts 12 services:

| Service | Port | Description |
|---------|------|-------------|
| postgres | 5432 (internal) | Main database |
| redis | 6379 (internal) | Cache, rate limits, counters |
| qdrant | 6333 (internal) | Vector database for semantic cache |
| clickhouse | 8123 (internal) | Analytics time-series database |
| backend | **8000** | Python FastAPI (auth, billing, API) |
| classifier | 8001 (internal) | ML request classifier |
| cache-service | 8002 (internal) | Semantic cache (Qdrant embeddings) |
| router | **8080** | Go reverse proxy (client-facing) |
| dashboard | **3000** | Next.js web UI |
| nginx | **80/443** | HTTPS termination, rate limiting |
| prometheus | 9090 (internal) | Metrics collection |
| grafana | **3001** | Monitoring dashboards |

> **Bold ports** are accessible from the host. Internal ports are only accessible within the Docker network.

### 4. Verify Health

```bash
# Check all services
docker compose ps

# Test health endpoints
curl http://localhost:8080/health   # Router (direct)
curl http://localhost:8000/health   # Backend (direct)
curl http://localhost:3000          # Dashboard (direct)
curl -sk https://localhost/health   # Nginx (TLS)
```

All services should show "healthy" within 60 seconds.

> **Note:** Ports 8080 and 8000 are exposed for local development.
> In production, remove the `ports` entries from `docker-compose.yml` and route all traffic through nginx (ports 80/443).

### 5. Create Your Account

Open [http://localhost:3000](http://localhost:3000) in your browser and click **Create account**.

> **Note:** Styx uses [Supabase](https://supabase.com) for authentication.
> Make sure `SUPABASE_URL` and `SUPABASE_ANON_KEY` (plus `NEXT_PUBLIC_*` variants)
> are set in your `.env` before starting the services. See the [Getting Started](./getting-started.md) guide for details.

---

## Stripe Setup (Billing)

To enable paid plans and credit purchases:

### 1. Create Stripe Products

```bash
# Install stripe SDK
pip install stripe

# Run the idempotent setup script
STRIPE_SECRET_KEY=sk_test_xxx python scripts/stripe_setup.py
```

This creates 7 Stripe products/prices (4 Charon plans + 3 Achilles plans).

### 2. Configure Price IDs

Copy the output into your `.env`:

```bash
STRIPE_PRICE_CHARON_SHADE=price_xxx
STRIPE_PRICE_CHARON_OBOL=price_xxx
STRIPE_PRICE_CHARON_FERRYMAN=price_xxx
STRIPE_PRICE_CHARON_TITAN=price_xxx
STRIPE_PRICE_ACHILLES_SPARK=price_xxx
STRIPE_PRICE_ACHILLES_BLAZE=price_xxx
STRIPE_PRICE_ACHILLES_INFERNO=price_xxx
```

### 3. Set Up Webhook

In Stripe Dashboard (Developers > Webhooks):

- **URL:** `https://api.yourdomain.com/api/billing/webhook`
- **Events:**
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`
- Copy the signing secret to `STRIPE_WEBHOOK_SECRET` in your `.env`

---

## Sentry Setup (Error Monitoring)

### Backend

Add to `.env`:
```bash
SENTRY_DSN=https://xxx@sentry.io/xxx
ENVIRONMENT=production
```

### Dashboard

Add to `dashboard/.env.local`:
```bash
NEXT_PUBLIC_SENTRY_DSN=https://xxx@sentry.io/xxx
SENTRY_DSN=https://xxx@sentry.io/xxx
SENTRY_AUTH_TOKEN=sntrys_xxx  # For source map uploads (optional)
```

---

## HTTPS / TLS

The included nginx configuration supports HTTPS with self-signed certs for development:

```bash
ls nginx/certs/
# server.crt  server.key
```

For production, replace with real certificates or use Let's Encrypt:

1. Replace `nginx/certs/server.crt` and `server.key` with your certificates
2. Or integrate with cert-manager if using Kubernetes (see Helm chart)

---

## Kubernetes Deployment

A full Helm chart is provided in `infra/helm/styx/`:

```bash
# Install with dev values
helm install styx infra/helm/styx -f infra/helm/styx/envs/dev.yaml

# Install with production values
helm install styx infra/helm/styx -f infra/helm/styx/envs/production.yaml
```

The Helm chart includes:
- All 8 application services as Deployments
- PostgreSQL and Redis as StatefulSets
- Qdrant and ClickHouse as StatefulSets
- NetworkPolicies for service isolation
- HPA (Horizontal Pod Autoscaler) for router and backend
- PodDisruptionBudgets for high availability
- Prometheus ServiceMonitor and PrometheusRules
- Grafana dashboards (3 pre-built)
- cert-manager integration for TLS
- External Secrets Operator support
- Scheduled backups via CronJob

### Environment-Specific Values

| File | Description |
|------|-------------|
| `envs/dev.yaml` | Single replica, debug mode, minimal resources |
| `envs/staging.yaml` | 2 replicas, staging secrets |
| `envs/production.yaml` | 3+ replicas, autoscaling, full monitoring |

---

## Monitoring

### Prometheus + Grafana

Both are included in docker-compose:

- **Prometheus:** `http://localhost:9090`
- **Grafana:** `http://localhost:3001` (admin / `changeme` — set `GRAFANA_PASSWORD` in `.env` to change)

Three pre-built Grafana dashboards:
1. **Styx Overview** — Request volume, latency, error rates
2. **Providers** — Per-provider health, latency, cost
3. **Infrastructure** — Resource usage, queue depth, cache hit rate

### Key Metrics

The Go router exposes Prometheus metrics on `/metrics`:
- `styx_requests_total` — Total requests (by provider, model, status)
- `styx_request_duration_seconds` — Latency histogram
- `styx_provider_health` — Provider health gauge
- `styx_cache_hits_total` — Semantic cache hit count

---

## Load Testing

K6 load test scenarios are provided in `infra/k6/`:

```bash
cd infra/k6
make smoke     # Quick smoke test
make load      # Standard load test
make stress    # Stress test (find breaking point)
make spike     # Spike test (sudden burst)
make soak      # Soak test (sustained load)
```

Results are exported to Prometheus and viewable in the k6 Grafana dashboard.

---

## Backup and Recovery

### Database Backup

The Helm chart includes a CronJob for scheduled PostgreSQL backups.

For Docker Compose, back up manually:

```bash
# Backup PostgreSQL
docker compose exec postgres pg_dump -U styx styx > backup.sql

# Restore
docker compose exec -T postgres psql -U styx styx < backup.sql
```

### Redis

Redis data is persisted to the `redisdata` volume. For explicit snapshots:

```bash
docker compose exec redis redis-cli -a YOUR_PASSWORD BGSAVE
```

---

## Troubleshooting

### Services won't start

Check dependency health:
```bash
docker compose ps
docker compose logs backend --tail 50
```

Common issues:
- **Backend crash:** Check `ENCRYPTION_KEY` is set (must be a valid Fernet key)
- **Qdrant unhealthy:** Normal on first start, give it 30 seconds
- **Router waiting:** Depends on backend + cache-service being healthy first

### Database migrations

Migrations run automatically on backend startup. To run manually:

```bash
docker compose exec backend alembic upgrade head
```

### Reset everything

```bash
docker compose down -v  # WARNING: Destroys all data
docker compose up -d
```

---

## Environment Variables Reference

See `.env.example` at the project root for the complete list. Key variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | Secret for JWT token signing |
| `INTERNAL_SECRET` | Yes | Service-to-service authentication |
| `API_KEY_HMAC_SECRET` | Yes | HMAC key for API key hashing |
| `ENCRYPTION_KEY` | Yes | Fernet key for encrypting provider keys |
| `REDIS_URL` | Yes | Redis connection string |
| `INSTANCE_ID` | Recommended | Stable UUID for this deployment (auto-generated if missing) |
| `SKIP_AUTH` | Optional | `true` = dev mode, no Supabase required |
| `STRIPE_SECRET_KEY` | For billing | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | For billing | Stripe webhook signing secret |
| `OPENAI_API_KEY` | At least 1 | OpenAI API key (Achilles mode) |
| `SENTRY_DSN` | Optional | Sentry error reporting DSN |
| `FRONTEND_URL` | Optional | Dashboard URL for email links |
