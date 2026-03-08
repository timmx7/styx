"""Redis-backed sliding-window rate limiter for auth endpoints.

Uses a circuit breaker pattern for Redis failures:
- First 2 failures: fail closed (503) for security
- 3rd+ consecutive failure: switch to degraded mode (allow with warning)
- After 30s in degraded mode: retry Redis
- On recovery: reset circuit
"""

import logging
import time

import redis.asyncio as aioredis
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.config import settings

logger = logging.getLogger("rate_limit")

# Rate limit rules: path prefix -> (max_requests, window_seconds)
AUTH_RATE_LIMITS: dict[str, tuple[int, int]] = {
    "/api/auth/login": (5, 60),              # 5 attempts per minute
    "/api/auth/register": (3, 60),           # 3 attempts per minute
    "/api/auth/forgot-password": (3, 60),    # 3 attempts per minute
    "/api/auth/reset-password": (5, 60),     # 5 attempts per minute
    "/api/auth/resend-verification": (3, 60),# 3 attempts per minute
    "/internal/validate-key": (200, 60),     # 200/min from Go router
    "/internal/log-usage": (500, 60),        # 500/min from Go router
    "/internal/budget": (200, 60),           # 200/min from Go router
    "/internal/routing-logs": (100, 60),     # 100/min from Go router
}

_redis_client: aioredis.Redis | None = None

# ── Circuit breaker state for Redis failures ──────────────────────
_redis_consecutive_failures: int = 0
_redis_degraded_since: float = 0.0
_FAILURE_THRESHOLD: int = 3           # fail closed for first N-1 failures
_DEGRADED_WINDOW_SECONDS: float = 30.0  # how long to stay in degraded mode


def _is_degraded() -> bool:
    """Check if we're in degraded mode (Redis confirmed down)."""
    if _redis_consecutive_failures < _FAILURE_THRESHOLD:
        return False
    if _redis_degraded_since <= 0:
        return False
    # Check if the degraded window has expired (time to retry Redis)
    return (time.time() - _redis_degraded_since) < _DEGRADED_WINDOW_SECONDS


def _record_redis_failure() -> None:
    """Record a Redis failure and potentially enter degraded mode."""
    global _redis_consecutive_failures, _redis_degraded_since
    _redis_consecutive_failures += 1
    if _redis_consecutive_failures >= _FAILURE_THRESHOLD and _redis_degraded_since <= 0:
        _redis_degraded_since = time.time()
        logger.warning(
            "Redis circuit breaker OPEN: entering degraded mode for %ds "
            "(allowing requests without rate limiting)",
            int(_DEGRADED_WINDOW_SECONDS),
        )


def _record_redis_success() -> None:
    """Record a Redis success and reset the circuit breaker."""
    global _redis_consecutive_failures, _redis_degraded_since
    if _redis_consecutive_failures > 0:
        logger.info("Redis circuit breaker CLOSED: Redis recovered")
    _redis_consecutive_failures = 0
    _redis_degraded_since = 0.0


async def _get_redis() -> aioredis.Redis | None:
    """Lazy-initialize async Redis connection for rate limiting."""
    global _redis_client
    if _redis_client is None:
        try:
            _redis_client = aioredis.from_url(
                settings.redis_url, decode_responses=True, socket_timeout=2
            )
            await _redis_client.ping()
        except Exception:
            _redis_client = None
    return _redis_client


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Redis-backed sliding-window rate limiter keyed by client IP + path.

    Only applies to paths listed in AUTH_RATE_LIMITS.
    Uses a circuit breaker pattern for Redis failures:
    - First 2 failures: fail closed (503) for security
    - 3+ consecutive failures: degraded mode (allow with warning log)
    - After 30s: retry Redis connection
    """

    def _get_client_ip(self, request: Request) -> str:
        """Extract real client IP from X-Real-IP (set by nginx) or X-Forwarded-For."""
        real_ip = request.headers.get("x-real-ip")
        if real_ip:
            return real_ip.strip()
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

    async def dispatch(self, request: Request, call_next) -> Response:
        # Normalize path: strip trailing slashes to prevent rate limit bypass
        path = request.url.path.rstrip("/") or "/"

        # Only rate limit configured paths
        rule = None
        for prefix, limit in AUTH_RATE_LIMITS.items():
            if path.startswith(prefix):
                rule = limit
                break

        if rule is None:
            return await call_next(request)

        max_requests, window_seconds = rule
        client_ip = self._get_client_ip(request)
        redis_key = f"ratelimit:auth:{client_ip}:{path}"

        # Circuit breaker: if in degraded mode, allow without checking Redis
        if _is_degraded():
            logger.debug("rate limiter in degraded mode, allowing request")
            return await call_next(request)

        r = await _get_redis()
        if r is None:
            # Redis unavailable on init — allow request but log
            return await call_next(request)

        try:
            now = time.time()
            pipe = r.pipeline()
            # Remove expired entries
            pipe.zremrangebyscore(redis_key, 0, now - window_seconds)
            # Count current entries
            pipe.zcard(redis_key)
            # Add current request
            pipe.zadd(redis_key, {str(now): now})
            # Set TTL on the key
            pipe.expire(redis_key, window_seconds)
            results = await pipe.execute()

            # Redis call succeeded — reset circuit breaker
            _record_redis_success()

            current_count = results[1]

            if current_count >= max_requests:
                # Get oldest entry to calculate retry-after
                oldest = await r.zrange(redis_key, 0, 0, withscores=True)
                retry_after = window_seconds
                if oldest:
                    retry_after = int(window_seconds - (now - oldest[0][1]))
                return Response(
                    content='{"detail":"Too many requests. Please try again later."}',
                    status_code=429,
                    media_type="application/json",
                    headers={"Retry-After": str(max(1, retry_after))},
                )
        except Exception as exc:
            _record_redis_failure()

            if _redis_consecutive_failures < _FAILURE_THRESHOLD:
                # Fail closed for first N-1 failures (security)
                logger.error(
                    "Redis unavailable for rate limiting (failure %d/%d): %s",
                    _redis_consecutive_failures,
                    _FAILURE_THRESHOLD,
                    exc,
                )
                from starlette.responses import JSONResponse
                return JSONResponse(
                    status_code=503,
                    content={
                        "error": {
                            "type": "service_unavailable",
                            "message": "Rate limiting service temporarily unavailable. Please try again.",
                            "code": 503,
                        }
                    },
                )
            else:
                # Degraded mode: allow request with warning
                logger.warning(
                    "Redis unavailable (degraded mode, failure %d): allowing request: %s",
                    _redis_consecutive_failures,
                    exc,
                )

        return await call_next(request)
