"""Styx Backend — FastAPI application entry point."""

import os
import uuid
from contextlib import asynccontextmanager

# ── Sentry (optional — activate by setting SENTRY_DSN) ─────────
_sentry_dsn = os.getenv("SENTRY_DSN", "")
if _sentry_dsn:
    import sentry_sdk
    sentry_sdk.init(
        dsn=_sentry_dsn,
        traces_sample_rate=0.1 if os.getenv("DEBUG", "").lower() != "true" else 1.0,
        send_default_pii=False,
        environment=os.getenv("ENVIRONMENT", "development"),
    )

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from sqlalchemy import text

from app.api import alerts, analytics, auth, billing, budget, credits, internal, keys, pricing, projects, prompts, provider_keys, teams, webhooks, ab_tests
from app.config import settings
from app.db import database as db_mod
from app.db.database import Base
from app.middleware.csrf import CSRFMiddleware
from app.middleware.rate_limit import RateLimitMiddleware
from app.middleware.security import RequestSizeLimitMiddleware, SecurityHeadersMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response


class RequestIDMiddleware(BaseHTTPMiddleware):
    """Middleware that ensures every request has an X-Request-ID.

    1. Reads X-Request-ID from incoming request headers.
    2. If not present, generates a UUID4.
    3. Stores it on request.state.request_id for downstream use.
    4. Adds it to the response headers.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["x-request-id"] = request_id
        return response


# Import all models so SQLAlchemy registers them
from app.models import (  # noqa: F401
    user, team, project, api_key, provider_key, usage_log, routing_log, alert,
    team_member, team_invitation,
    audit_log, webhook,
    subscription, credit_balance, credit_transaction, model_pricing, prompt,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: verify DB connection, optionally create tables (dev only).

    In production, use Alembic migrations. Base.metadata.create_all is only
    executed when DEBUG=true to avoid accidental schema drift.
    """
    # Use db_mod.engine (not a captured import) so tests can patch it
    async with db_mod.engine.begin() as conn:
        await conn.execute(text("SELECT 1"))  # verify connection
        if settings.debug:
            await conn.run_sync(Base.metadata.create_all)

    # Validate security-critical settings at startup
    if not settings.debug:
        import logging as _logging
        _log = _logging.getLogger("startup")

        if not settings.stripe_secret_key:
            _log.warning(
                "STRIPE_SECRET_KEY not configured — billing features will use mock mode."
            )

    # Ensure ClickHouse schema exists (idempotent, non-blocking on failure)
    try:
        from app.services.clickhouse_service import ensure_schema
        await ensure_schema()
    except Exception as e:
        import logging
        logging.getLogger("startup").warning(f"ClickHouse schema check failed: {e}")

    # Start the dynamic pricing sync as a background task
    import asyncio
    from app.services.sync_pricing import start_periodic_sync
    pricing_sync_task = asyncio.create_task(start_periodic_sync(interval_hours=24))

    yield

    # Cancel background tasks gracefully
    pricing_sync_task.cancel()
    try:
        await pricing_sync_task
    except asyncio.CancelledError:
        pass

    await db_mod.engine.dispose()


app = FastAPI(
    title="Styx Backend",
    description="Business logic, auth, and billing for the Styx gateway.",
    version="0.1.0",
    lifespan=lifespan,
)

# ─── Security Middleware (applied bottom-up, first added = outermost) ─

# 0. X-Request-ID tracing on every request/response (outermost)
app.add_middleware(RequestIDMiddleware)

# 1. Security response headers on every response
app.add_middleware(SecurityHeadersMiddleware)

# 2. Request body size limit (10 MB default)
app.add_middleware(RequestSizeLimitMiddleware, max_body_bytes=settings.max_request_body_bytes)

# 3. CSRF protection (Origin header validation on state-changing requests)
app.add_middleware(CSRFMiddleware)

# 4. Rate limiting on auth endpoints (Redis-backed)
app.add_middleware(RateLimitMiddleware)

# 5. Trusted host validation (prevent host-header attacks)
allowed_hosts = settings.allowed_hosts.split(",")
if allowed_hosts != ["*"]:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts)

# ─── CORS ────────────────────────────────────────────────────────
cors_origins = [
    o.strip() for o in settings.cors_origins.split(",") if o.strip()
] if settings.cors_origins else ["http://localhost:3000", "http://127.0.0.1:3000"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    expose_headers=[
        "x-styx-provider",
        "x-styx-model",
        "x-styx-cache-hit",
        "x-styx-latency-ms",
        "x-request-id",
    ],
)

# Public API routes
app.include_router(auth.router, prefix="/api")
app.include_router(projects.router, prefix="/api")
app.include_router(keys.router, prefix="/api")
app.include_router(billing.router, prefix="/api")
app.include_router(budget.router, prefix="/api")
app.include_router(alerts.router, prefix="/api")
app.include_router(analytics.router, prefix="/api")
app.include_router(teams.router, prefix="/api")
app.include_router(provider_keys.router, prefix="/api")
app.include_router(webhooks.router, prefix="/api")
app.include_router(credits.router, prefix="/api")
app.include_router(pricing.router, prefix="/api")
app.include_router(ab_tests.router, prefix="/api")
app.include_router(prompts.router, prefix="/api")

# Internal routes (Go router -> Backend, Docker network only)
app.include_router(internal.router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "backend"}


@app.get("/api/instance")
async def instance_info():
    """Return stable identity info for this Styx deployment.

    No authentication required — safe to call from the dashboard before login.
    The instance_id is generated once by setup.sh and stored in .env.
    """
    return {
        "instance_id": settings.instance_id,
        "version": "0.1.0",
        "skip_auth": settings.skip_auth,
    }
