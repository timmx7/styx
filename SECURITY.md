# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Styx, please report it responsibly:

- **Email**: security@styxhq.com
- **GitHub**: [Security Advisories](https://github.com/styx-hq/styx/security/advisories/new) (private disclosure)

**Please do NOT report security vulnerabilities through public GitHub issues.**

## Response Timeline

- Acknowledgment within 48 hours
- Initial assessment within 5 business days
- Critical vulnerabilities patched as quickly as possible

## Scope

This policy covers:
- Styx gateway (Go router)
- Python backend API
- MCP server
- Dashboard (Next.js)
- Official packages (npm: styx-mcp-server)

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest  | Yes       |
| < Latest | No       |

## Security Architecture

Styx implements defense-in-depth across all layers.

### Encryption at Rest

- **Provider API keys** are encrypted using Fernet (AES-128-CBC + HMAC-SHA256) via the `cryptography` library
- Versioned ciphertext format (`v1:{token}`) supports seamless key rotation with `ENCRYPTION_KEY` and `ENCRYPTION_KEY_PREVIOUS`
- **Styx API keys** are hashed with HMAC-SHA256 using a server-side secret (`API_KEY_HMAC_SECRET`) — plaintext keys are returned once at creation and never stored
- Key prefixes (first 15 chars) are stored separately for display; full keys cannot be recovered

### Authentication

- JWT-based authentication via Supabase Auth (RS256 with JWKS, HS256 fallback)
- Token blacklisting in Redis on logout with TTL-based expiry
- API key validation cached in the Go router with SHA-256 in-memory hashing, bounded LRU (10,000 entries, 30s TTL)
- Real-time key revocation via Redis pub/sub
- Supabase webhook signature verification (HMAC-SHA256)

### Rate Limiting

- **Backend**: Redis-backed sliding window (Sorted Sets) — 5 req/min on login, 3 req/min on registration
- **Router**: Per-API-key rate limiting via atomic Redis Lua scripts (prevents TOCTOU races)
- **nginx**: Zone-based rate limiting (30 req/s API, 5 req/min auth)
- End-user rate limiting with `X-End-User-Id` header support
- Standard `Retry-After` and `X-RateLimit-*` response headers

### Transport Security

- TLS termination at nginx with TLSv1.2 and TLSv1.3 only
- ECDHE cipher suites (AES-128-GCM, AES-256-GCM)
- HSTS enabled (2 years, includeSubDomains, preload)
- HTTP-to-HTTPS redirect (301)
- cert-manager integration for automatic Let's Encrypt certificates in Kubernetes

### Security Headers

Applied at both the Go router and nginx layers:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` (disables camera, microphone, geolocation, payment)
- `Content-Security-Policy` with restrictive directives (`default-src 'self'`, `frame-ancestors 'none'`)
- `Cache-Control: no-store` on API responses

### Input Validation

- **Go router**: Regex validation on model names (blocks path traversal, `..`), request IDs (blocks log injection), and allowed API paths (whitelist)
- **Python backend**: Pydantic models with EmailStr, password complexity (uppercase, lowercase, digit, special char), and field length constraints
- Request body size limit: 10 MB
- Streaming response size limit: 50 MB

### CORS & CSRF

- CORS origins configured via environment variable; disabled if not set
- CSRF protection via Origin header validation on mutating requests
- Internal endpoints exempt (authenticated via `X-Internal-Secret`)
- Non-browser clients (SDKs, CLIs) allowed through without Origin

### SSRF Prevention

- Webhook URLs validated against blocked networks: `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` (AWS metadata), IPv6 loopback and link-local
- Hostname blocklist: `localhost`, `metadata.google.internal`, `*.internal`, `*.local`
- DNS resolution timeout: 10 seconds

### Circuit Breaker & Fallback

- Per-provider circuit breaker (Closed / Open / Half-Open states)
- Configurable failure threshold (default: 5 consecutive failures)
- Automatic provider failover with health check probes (15s interval)
- Half-open recovery with single test request

### Audit Logging

- Append-only audit trail: `{resource}.{verb}` format (e.g., `api_key.create`, `user.login`)
- Captures actor ID, email, IP, action, resource, status
- Fire-and-forget — never breaks business logic
- No PII in audit detail fields

### PII Handling

- Compiled regex patterns detect email addresses, phone numbers, and credit card numbers in responses
- Request and response bodies are never logged — only metadata (status, latency, model, provider)
- Structured logging with request ID correlation

### Network Isolation (Kubernetes)

- Kubernetes NetworkPolicies enforce east-west traffic restrictions:
  - Classifier and cache service accept traffic only from the router
  - Databases accept traffic only from authorized services
  - External traffic restricted to HTTPS (port 443) with private ranges blocked

### Secret Management

- All secrets via environment variables — never hardcoded
- Kubernetes Secrets with validation (fails if required secrets missing)
- External Secrets Operator integration (AWS Secrets Manager, HashiCorp Vault)
- Secret generation documented: `openssl rand -base64 32` for HMAC keys, `Fernet.generate_key()` for encryption

### Static Analysis

- Bandit security linter configured (`.bandit.yaml`) for injection, crypto, deserialization, and SQL injection checks
- GitHub Actions security workflow for CI/CD scanning
