<div align="center">
  <h1>⚡ Styx</h1>
  <p><strong>The MCP-Native AI Gateway</strong></p>
  <p>Route requests to any AI provider through one universal endpoint.<br/>
  Self-hosted. Open source. BYOK.</p>

  <!-- Badges -->
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" /></a>
  <a href="https://github.com/timmx7/styx/stargazers"><img src="https://img.shields.io/github/stars/timmx7/styx" /></a>
  <a href="https://github.com/timmx7/styx/issues"><img src="https://img.shields.io/github/issues/timmx7/styx" /></a>
</div>

---

## What is Styx?

Styx is an open-source AI gateway that sits between your app and AI providers. Send requests to OpenAI, Anthropic, Google, or Mistral — all through one OpenAI-compatible endpoint. Bring your own API keys, self-host on your infra, and get full visibility into every request.

**The first AI gateway with native MCP (Model Context Protocol) support.**

```python
from openai import OpenAI

client = OpenAI(
    api_key="your-styx-api-key",
    base_url="http://localhost:8080/v1",  # ← Only change needed
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello from Styx"}],
)
```

## Features

- 🔌 **MCP Native** — Built-in MCP server. Connect Claude Code or Cursor in one command
- 🔀 **Universal Routing** — One OpenAI-compatible endpoint for all providers
- 🤖 **styx:auto** — Intelligent model routing: use `"model": "styx:auto"` and let Styx pick the right model based on request complexity
- 🔑 **BYOK** — Bring your own API keys, encrypted at rest (Fernet/AES)
- 📊 **Dashboard** — Track requests, costs, latency per project and model
- 🔄 **Fallbacks** — Auto-failover between providers with circuit breakers
- 💰 **Billing** — Built-in subscription and credit-based billing (Stripe)
- 🧠 **Semantic Cache** — Similar questions return cached responses instantly
- ⚡ **Smart Routing** — ML classifier routes to the optimal model for each request
- 🐳 **Self-Hosted** — Docker Compose, 5-minute setup
- 🔒 **Secure** — HMAC key hashing, Fernet encryption, rate limiting, TLS

## Prerequisites

- **Docker Engine 24+** and Docker Compose v2
- **At least one AI provider API key** (OpenAI, Anthropic, Google, or Mistral)
- **Supabase account** ([free tier](https://supabase.com)) — only for production mode (not needed for dev mode)

## Quick Start

### Option A: Setup Wizard (recommended)

```bash
git clone https://github.com/timmx7/styx.git
cd styx
./setup.sh                 # interactive wizard, generates .env
docker compose up -d --build   # first build: ~15-20 min; subsequent starts: ~60s
```

The wizard lets you choose between:
- **Dev mode** — No Supabase needed, no authentication, instant start
- **Production mode** — Full Supabase auth, account creation, API keys

### Option B: Manual Setup

```bash
git clone https://github.com/timmx7/styx.git
cd styx
cp .env.example .env
```

Edit `.env` with:
1. Set `SKIP_AUTH=true` for dev mode, or configure **Supabase** for production
2. At least one **AI provider key** (e.g., `OPENAI_API_KEY`)

```bash
docker compose up -d --build   # first build: ~15-20 min; subsequent starts: ~60s
```

### Access Points

- **Dashboard:** http://localhost:3000
- **API Gateway:** http://localhost:8080 (direct) or https://localhost/v1 (via nginx/TLS)
- **Docs API:** https://localhost/api (via nginx)

### Connect Claude Code

```bash
claude mcp add styx -- npx styx-mcp
```

### Connect Cursor

Add to `.cursor/mcp.json`:

```json
{
  "styx": {
    "command": "npx",
    "args": ["styx-mcp"],
    "env": { "STYX_API_KEY": "your-key" }
  }
}
```

### Send your first request

```bash
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer YOUR_STYX_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello from Styx"}]
  }'
```

> **Dev mode:** skip the `Authorization` header — requests are accepted without an API key.

### Use with any OpenAI SDK

```typescript
// Node.js / TypeScript
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "your-styx-key",
  baseURL: "http://localhost:8080/v1",
});
```

```python
# Python
from openai import OpenAI

client = OpenAI(
    api_key="your-styx-key",
    base_url="http://localhost:8080/v1",
)
```

## Supported Providers

| Provider | Models | Status |
|----------|--------|--------|
| OpenAI | gpt-4.1, gpt-4.1-mini, gpt-4o, gpt-4o-mini, o3, o4-mini | ✅ |
| Anthropic | claude-sonnet-4, claude-3-5-sonnet, claude-3-5-haiku, claude-3-haiku | ✅ |
| Google | gemini-2.5-pro, gemini-2.5-flash, gemini-2.5-flash-lite, gemini-2.0-flash | ✅ |
| Mistral | mistral-large, mistral-medium-3, mistral-small, codestral | ✅ |
| Azure OpenAI | Same as OpenAI models, via Azure deployments | ✅ |

> **Auto-routing:** Any model matching the provider prefixes above (`gpt-*`, `claude-*`, `gemini-*`, `mistral-*`, `o3*`, `o4*`) is routed automatically — even models released after your last config update.

## Architecture

```
┌─────────┐     ┌──────────────┐     ┌───────────────┐
│  Client  │────▶│  Go Router   │────▶│  AI Provider  │
│  (app)   │◀────│  (port 8080) │◀────│  (OpenAI...)  │
└─────────┘     └──────┬───────┘     └───────────────┘
                       │
                ┌──────▼───────┐
                │ Python API   │
                │ (port 8000)  │
                │ Auth/Billing │
                └──────┬───────┘
                       │
          ┌────────────┼────────────┐
          │            │            │
    ┌─────▼──┐  ┌──────▼──┐  ┌─────▼──┐
    │Postgres│  │  Redis   │  │ Next.js│
    │  (DB)  │  │ (cache)  │  │ (UI)   │
    └────────┘  └─────────┘  └────────┘
```

**Request flow:**

```
Client request
    │
    ▼
Go Router (:8080) ──▶ Cache check ──▶ HIT? Return instantly
    │                                   MISS? Continue...
    ▼
Budget check ──▶ OVER LIMIT? Block + alert
    │              OK? Continue...
    ▼
Route to best provider (OpenAI / Anthropic / Google / Mistral)
    │
    ▼
Provider error? ──▶ Automatic fallback (circuit breaker)
    │
    ▼
Response to client + log to ClickHouse + update Redis counters
```

## Project Structure

```
styx/
├── router/          # Go reverse proxy — the fast path (<10ms overhead)
├── backend/         # Python FastAPI — auth, billing, business logic
├── dashboard/       # Next.js + Tailwind — web dashboard
├── classifier/      # ML request classifier (complexity scoring)
├── cache-service/   # Semantic cache (Qdrant + sentence-transformers)
├── sdk/             # Python & Node.js client SDKs
├── packages/        # MCP server, gateway CLI
├── infra/           # Docker, Helm, K8s, k6 load tests, Prometheus
└── docker-compose.yml
```

## Comparison

| Feature | Styx | OpenRouter | LiteLLM | Portkey |
|---------|------|-----------|---------|---------|
| MCP Native | ✅ | ❌ | ❌ | ❌ |
| Self-Hosted | ✅ | ❌ | ✅ | ❌ |
| Open Source | ✅ Apache 2.0 | ❌ | ✅ | ❌ |
| Dashboard | ✅ Full | ❌ | Basic | ✅ |
| BYOK | ✅ Encrypted | ❌ | ✅ | ✅ |
| Semantic Cache | ✅ | ❌ | ❌ | ❌ |
| Smart Routing | ✅ ML | ❌ | ❌ | ✅ |
| Circuit Breaker | ✅ | ❌ | ✅ | ✅ |
| One-Command Install | ✅ | N/A | ❌ | N/A |

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache 2.0 — see [LICENSE](LICENSE) for details.

## Styx Cloud

Want managed hosting with advanced analytics, team management, and SSO?

→ [styx.app](https://styx.app) (coming soon)
