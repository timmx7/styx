# Getting Started with Styx

Get your first AI request flowing through Styx in under 5 minutes.

## Prerequisites

- **Docker Engine 24+** and Docker Compose v2
- **At least one AI provider API key** (OpenAI, Anthropic, Google, or Mistral)
- **Supabase account** (free tier) — only needed for production mode
- Python 3.8+ or Node.js 18+ (or any language with HTTP support)

## Choose Your Path

### Path A: Dev Mode (fastest, no external accounts needed)

Use the interactive setup wizard:

```bash
git clone https://github.com/timmx7/styx.git
cd styx
./setup.sh           # select "Dev mode" when prompted
docker compose up -d --build
```

Wait ~60 seconds for all 12 services to become healthy:

```bash
docker compose ps   # all should show "healthy"
```

Open [http://localhost:3000](http://localhost:3000) — you are logged in as "Dev User" automatically. An orange banner reminds you that authentication is disabled.

**Send your first request** (no API key needed in dev mode):

```bash
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello from Styx"}]
  }'
```

That's it — skip to [Try Different Providers](#step-6-try-different-providers) below.

---

### Path B: Production Mode (Supabase auth)

Follow the steps below for full authentication with user accounts and API keys.

## Step 1: Set Up Supabase

1. Go to [supabase.com](https://supabase.com) and create a free project
2. In your Supabase project dashboard, go to **Settings → API** to find your Project URL and anon public key. Copy them into `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in your `.env` file.

## Step 2: Configure and Start Styx

You can use the setup wizard (`./setup.sh` and select "Production") or configure manually:

```bash
git clone https://github.com/timmx7/styx.git
cd styx
cp .env.example .env
```

Edit `.env` and set at minimum:

```bash
# Supabase (required for production auth)
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...

# At least one AI provider key
OPENAI_API_KEY=sk-your-openai-key
```

Start all services:

```bash
docker compose up -d --build
```

Wait ~60 seconds for all 12 services to become healthy:

```bash
docker compose ps   # all should show "healthy"
```

## Step 3: Create an Account

Open [http://localhost:3000](http://localhost:3000) in your browser.

1. Click **Create account**
2. Enter your name, email, and password
3. Check your email for the confirmation link (Supabase sends it)
4. After confirming, log in

## Step 4: Create a Project and API Key

Once logged in to the dashboard:

1. A **Default Project** is automatically created for you
2. Go to **API Keys** in the sidebar
3. Click **Create Key**, give it a name
4. **Copy the key immediately** — it's shown only once (starts with `sk_styx_`)

## Step 5: Send Your First Request

Replace your OpenAI base URL with the Styx proxy. That's it.

### cURL

```bash
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer sk_styx_YOUR_KEY_HERE" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello from Styx"}]
  }'
```

### Python (OpenAI SDK)

```python
from openai import OpenAI

client = OpenAI(
    api_key="sk_styx_YOUR_KEY_HERE",
    base_url="http://localhost:8080/v1",  # <-- only change
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello from Styx"}],
)

print(response.choices[0].message.content)
```

### Node.js

```javascript
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "sk_styx_YOUR_KEY_HERE",
  baseURL: "http://localhost:8080/v1",
});

const response = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello from Styx" }],
});

console.log(response.choices[0].message.content);
```

## Step 6: Try Different Providers

Switch providers by changing the model name — no code changes needed:

```bash
# OpenAI
curl ... -d '{"model": "gpt-4o", ...}'

# Anthropic (requires ANTHROPIC_API_KEY in .env)
curl ... -d '{"model": "claude-sonnet-4-20250514", ...}'

# Google (requires GOOGLE_API_KEY in .env)
curl ... -d '{"model": "gemini-2.0-flash", ...}'

# Mistral (requires MISTRAL_API_KEY in .env)
curl ... -d '{"model": "mistral-large-latest", ...}'
```

## Step 7: Let Styx Choose for You (styx:auto)

Don't want to think about which model to use? Use one of Styx's virtual smart models:

| Virtual model | Behavior |
|---------------|----------|
| `styx:auto` | Scores request complexity with 9 signals and picks the right tier automatically |
| `styx:fast` | Always uses the cheapest, fastest model (light tier) |
| `styx:balanced` | Always uses a balanced model (medium tier) |
| `styx:frontier` | Always uses the most powerful model (heavy tier) |

```bash
# Let Styx decide — "Hi" → light model, "Prove the Riemann hypothesis" → heavy model
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "styx:auto",
    "messages": [{"role": "user", "content": "What is 2+2?"}]
  }'
```

The response includes extra headers explaining the decision:

```
X-Styx-Auto-Original: styx:auto
X-Styx-Auto-Tier:     light
X-Styx-Auto-Score:    5
X-Styx-Model:         gpt-4.1-nano
X-Styx-Provider:      openai
```

See the [API Reference](./api-reference.md#smart-models-styxauto) for details on all 9 complexity signals.

## What Happens Behind the Scenes

1. The Go router receives your request on `:8080`
2. Your API key is validated against the Python backend (skipped in dev mode)
3. The semantic cache checks for similar recent requests (Qdrant)
4. If cache miss: the request classifier picks optimal routing
5. The request is forwarded to the best provider
6. If the provider fails, automatic fallback to the next one
7. Response is returned, usage is logged to ClickHouse, Redis counters updated

## Dashboard Pages

Once the dashboard is running at `http://localhost:3000`, here is what each page does:

| Page | Path | Purpose |
|------|------|---------|
| **Overview** | `/overview` | High-level stats: total requests, spend, cache hit rate, and latency across all projects. Starting point after login. |
| **Projects** | `/projects` | Create and manage projects. Each project is an isolated billing and routing unit with its own API keys and budget. |
| **Playground** | `/prompts` | Create and manage system prompt templates. Activate a prompt to inject it automatically into all requests for a project — no backend code change needed. |
| **API Keys** | `/keys` | Generate Styx API keys (`sk_styx_...`). Each key is tied to a project. Copy on creation — it is shown only once. |
| **Analytics** | `/analytics` | Request volume by day, provider distribution, model usage, latency trends. Filter by 7d / 30d / 90d. |
| **Logs** | `/logs` | Per-request log: model, provider, latency, tokens, cost, cache hit. Useful for debugging routing decisions. |
| **Routing** | `/routing` | Configure routing strategy per project: `cost_optimized`, `latency_first`, `quality_first`, or `round_robin`. Restrict which providers a project can use. |
| **Settings** | `/settings` | Instance info (Instance ID for support), danger zone (reset), and notification preferences (coming soon). |
| **Billing** | `/billing` | 🔒 Coming soon — Stripe integration for managed key usage. |
| **Team** | `/team` | 🔒 Coming soon — invite team members, assign roles. |
| **End-Users** | `/analytics/users` | 🔒 Coming soon — per end-user analytics when you pass `X-User-ID` in requests. |
| **Alerts** | `/alerts` | 🔒 Coming soon — budget threshold alerts via email/Slack. |

> Pages marked 🔒 are visible but blurred — they are planned features not yet functional in v1.

## Next Steps

- [API Reference](./api-reference.md) for all endpoints
- [Providers Guide](./providers.md) to understand routing and models
- [Billing Guide](./billing.md) for Charon vs Achilles details
- [Self-Hosting Guide](./self-hosting.md) to run your own instance
- [MCP Server](./mcp-server.md) to use Styx from Claude Code
