# Provider Guide

Styx routes requests to AI providers through the Go router. This guide covers supported providers, model routing, and failover behavior.

## Supported Providers

| Provider | Adapter | Models | Endpoint |
|----------|---------|--------|----------|
| **OpenAI** | `openai.go` | gpt-4.1, gpt-4.1-mini, o3, o4-mini, gpt-4o, gpt-4o-mini | `api.openai.com/v1` |
| **Anthropic** | `anthropic.go` | claude-sonnet-4, claude-3-5-sonnet, claude-3-5-haiku, claude-3-haiku | `api.anthropic.com/v1` |
| **Google** | `google.go` | gemini-2.5-pro, gemini-2.5-flash, gemini-2.5-flash-lite, gemini-2.0-flash | `generativelanguage.googleapis.com` |
| **Mistral** | `mistral.go` | mistral-large, mistral-medium-3, mistral-small, codestral | `api.mistral.ai/v1` |
| **Azure OpenAI** | `azure.go` | Same as OpenAI, via Azure deployments | `{resource}.openai.azure.com` |

### Model Reference (March 2026)

#### OpenAI
| Model ID | Tier | Input ($/1M) | Output ($/1M) | Notes |
|----------|------|-------------|--------------|-------|
| `gpt-4.1` | heavy | $2.00 | $8.00 | Smartest non-reasoning model |
| `gpt-4.1-mini` | medium | $0.40 | $1.60 | Fast, cost-efficient |
| `o3` | heavy | $10.00 | $40.00 | Best-in-class reasoning |
| `o4-mini` | medium | $1.10 | $4.40 | Fast reasoning |
| `gpt-4o` | heavy | $2.50 | $10.00 | Multimodal flagship |
| `gpt-4o-mini` | light | $0.15 | $0.60 | Budget workhorse |

#### Anthropic
| Model ID | Tier | Input ($/1M) | Output ($/1M) | Notes |
|----------|------|-------------|--------------|-------|
| `claude-sonnet-4-20250514` | heavy | $3.00 | $15.00 | Claude 4 Sonnet |
| `claude-3-5-sonnet-20241022` | heavy | $3.00 | $15.00 | Claude 3.5 Sonnet |
| `claude-3-5-haiku-20241022` | medium | $0.80 | $4.00 | Fast & capable |
| `claude-3-haiku-20240307` | light | $0.25 | $1.25 | Budget (legacy) |

#### Google
| Model ID | Tier | Input ($/1M) | Output ($/1M) | Notes |
|----------|------|-------------|--------------|-------|
| `gemini-2.5-pro` | heavy | $1.25 | $10.00 | Best Gemini model |
| `gemini-2.5-flash` | medium | $0.30 | $2.50 | Balanced |
| `gemini-2.5-flash-lite` | light | $0.10 | $0.40 | Fastest & cheapest |
| `gemini-2.0-flash` | light | $0.10 | $0.40 | Retiring June 2026 |

#### Mistral
| Model ID | Tier | Input ($/1M) | Output ($/1M) | Notes |
|----------|------|-------------|--------------|-------|
| `mistral-large-latest` | heavy | $2.00 | $6.00 | Flagship |
| `mistral-medium-3` | medium | $0.40 | $2.00 | Balanced |
| `mistral-small-latest` | light | $0.10 | $0.30 | Budget |
| `codestral-latest` | medium | $0.30 | $0.90 | Code specialist |

All adapters implement the same `Provider` interface in Go, ensuring uniform request/response handling.

## How Routing Works

```
Incoming request
    |
    v
Step 1: Explicit model lookup (config/config.yaml)
  Configured model? --> route to its provider
    |
    v
Step 2: Passthrough prefix inference
  "gpt-*" / "o1*" / "o3*" / "o4*"              --> OpenAI
  "claude-*"                                      --> Anthropic
  "gemini-*" / "learnlm-*"                       --> Google
  "mistral-*" / "codestral-*" / "open-mixtral-*" --> Mistral
    |
    v
Step 3: Smart tier routing (if prefix unrecognized)
  Complexity score --> light / medium / heavy tier --> cheapest provider
    |
    v
Provider healthy? (circuit breaker)
  YES --> forward request
  NO  --> fallback to next tier or error
```

This three-step chain means newer models (e.g., `gpt-4.2`, `claude-opus-5-20261001`) are
routed correctly even before they are added to `config.yaml`.

### Route Selection

The Go router selects providers based on:

1. **Explicit config** (primary): Models listed in `config/config.yaml` route directly
2. **Prefix passthrough** (step 2): Unknown models with recognizable prefixes are auto-routed
3. **Smart tier routing** (step 3): Unrecognized models fall back to complexity-based routing
4. **Routing rules** (`config/config.yaml`): Custom rules can restrict allowed providers
5. **Health status**: Unhealthy providers are skipped automatically

### Smart Routing (Classifier)

When the classifier service is enabled, requests can be routed based on complexity:

- **Simple queries** (greetings, factual lookups) route to cheaper, faster models
- **Complex queries** (code generation, reasoning) route to premium models
- The classifier uses a scikit-learn model trained on request patterns

## Failover and Circuit Breaker

The Go router implements robust failover:

### Circuit Breaker

Each provider has an independent circuit breaker with three states:

| State | Behavior |
|-------|----------|
| **Closed** | Normal operation, requests forwarded |
| **Open** | Provider is down, requests skip immediately |
| **Half-Open** | Testing recovery, limited requests sent |

Configuration (in `config/config.yaml`):
- Failure threshold: Number of failures before opening (default: 5)
- Recovery timeout: Time before testing recovery (default: 30s)

### Retry Logic

Failed requests are retried with exponential backoff:
- Max retries: 3 (configurable)
- Base delay: 100ms, doubles each retry
- Jitter added to prevent thundering herd

### Health Checks

Background goroutines ping each provider's health endpoint every 10 seconds. Providers that fail 3 consecutive checks are marked unhealthy.

## Semantic Cache

Before routing to a provider, the cache service checks if a semantically similar request was made recently:

1. Request text is embedded using `all-MiniLM-L6-v2`
2. Qdrant performs cosine similarity search
3. If similarity > 0.98 (configurable), the cached response is returned
4. Cached responses skip the provider entirely (zero cost, sub-10ms latency)

Cache TTL defaults to 24 hours.

## Request Format

The proxy accepts OpenAI-compatible request format for all providers:

```json
{
  "model": "claude-sonnet-4-20250514",
  "messages": [
    {"role": "system", "content": "You are helpful."},
    {"role": "user", "content": "Explain quantum computing."}
  ],
  "max_tokens": 1024,
  "temperature": 0.7,
  "stream": true
}
```

The Go adapter translates this to each provider's native format:
- **Anthropic**: Moves `system` message to the `system` parameter
- **Google**: Converts to Gemini `generateContent` format
- **Mistral**: Native OpenAI-compatible (no translation needed)

## Streaming (SSE)

All providers support streaming via Server-Sent Events. Pass `"stream": true` in your request:

```bash
curl -N http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer sk_styx_xxx" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4o", "messages": [{"role": "user", "content": "Hi"}], "stream": true}'
```

The Go router handles SSE chunking and re-streaming for all providers, maintaining consistent `data: {"choices":[...]}` format regardless of upstream provider.

## Provider Keys

### Charon Mode (BYOK)

In Charon mode, you bring your own API keys. Configure them as environment variables in your `.env` file:

```bash
# .env
OPENAI_API_KEY=sk-your-openai-key
ANTHROPIC_API_KEY=sk-ant-your-anthropic-key
GOOGLE_API_KEY=your-google-key
MISTRAL_API_KEY=your-mistral-key
```

Then restart the router: `docker compose restart router`

You can also set per-project provider keys through the dashboard (**Settings → Provider Keys**) or the API (`POST /api/provider-keys/{project_id}`). Per-project keys are stored encrypted in the database (Fernet/AES) and override the global environment variables for that project.

### Achilles Mode (Managed)

In Achilles mode, Styx provides the provider API keys. You pay per token via credits, with a 30% markup over raw provider costs. No provider key configuration needed.

## Adding a New Provider

To add a new provider to the Go router:

1. Create `router/internal/providers/newprovider.go`
2. Implement the `Provider` interface:
   - `Name() string`
   - `TransformRequest(*http.Request) error`
   - `TransformResponse(*http.Response) error`
   - `HealthCheck(ctx context.Context) error`
3. Register the provider in the `switch name` block in `router/cmd/server/main.go`
4. Add routing rules to `config/config.yaml`
5. Add to `PROVIDER_CHOICES` in the backend validation
