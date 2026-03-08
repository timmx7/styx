# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Styx, please report it responsibly:

**Email**: security@styx.app

Please do **NOT** open a public GitHub issue for security vulnerabilities.

We will acknowledge your report within 48 hours and aim to release a fix within 7 days for critical issues.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | ✅        |

## Security Best Practices

When self-hosting Styx:

- Change **all** default passwords in `.env` (`POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `CLICKHOUSE_PASSWORD`, `GRAFANA_PASSWORD`)
- Generate unique secrets:
  - `INTERNAL_SECRET`: `openssl rand -base64 32`
  - `API_KEY_HMAC_SECRET`: `openssl rand -base64 32`
  - `JWT_SECRET`: `openssl rand -base64 32`
  - `ENCRYPTION_KEY`: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
- Use **HTTPS** in production (reverse proxy with nginx/Caddy + Let's Encrypt)
- Set `DEBUG=false` and `COOKIE_SECURE=true` in production
- Keep Docker images updated
- Restrict network access to internal endpoints (`/internal/*`)

## Security Architecture

- **API keys**: Hashed with HMAC-SHA256 (server-side secret), never stored in plain text
- **Provider keys (BYOK)**: Encrypted at rest with Fernet (AES-128-CBC + HMAC-SHA256)
- **Authentication**: Supabase Auth with JWT (RS256/ES256 via JWKS)
- **Token revocation**: Redis-backed blacklist with TTL matching token expiry
- **Rate limiting**: Nginx-level (30 req/s API, 5 req/min auth) + Go-level token bucket
- **TLS**: TLS 1.2+ enforced, modern cipher suites only
- **Headers**: HSTS, CSP, X-Frame-Options DENY, X-Content-Type-Options nosniff
