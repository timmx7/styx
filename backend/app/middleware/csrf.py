"""CSRF protection middleware for state-changing requests.

For API-first backends using JWT tokens, the primary CSRF defence is
the ``SameSite`` cookie attribute (handled by the frontend) combined
with checking the ``Origin`` / ``Referer`` header against allowed origins.

This middleware:
1. Skips safe (idempotent) methods: GET, HEAD, OPTIONS.
2. Allows requests with no ``Origin`` header (non-browser clients,
   e.g. curl, SDKs, the Go router).
3. When an ``Origin`` *is* present, validates it against
   ``settings.cors_origins``.
4. Internal endpoints (``/internal/``) are exempt — they use a shared
   secret, not cookies.
"""

import logging

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.config import settings

logger = logging.getLogger("csrf")

# Methods that never change state — always allowed.
_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def _get_allowed_origins() -> set[str]:
    """Build the set of allowed origins from settings."""
    if settings.cors_origins:
        origins = {o.strip().rstrip("/") for o in settings.cors_origins.split(",") if o.strip()}
    else:
        origins = {"http://localhost:3000", "http://127.0.0.1:3000"}
    return origins


class CSRFMiddleware(BaseHTTPMiddleware):
    """Validates ``Origin`` header on state-changing requests.

    Non-browser clients (no ``Origin`` header) are allowed through
    because they cannot be exploited by CSRF attacks.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        # 1. Safe methods — always allowed
        if request.method in _SAFE_METHODS:
            return await call_next(request)

        # 2. Internal endpoints — authenticated by X-Internal-Secret
        if request.url.path.startswith("/internal/"):
            return await call_next(request)

        # 3. No Origin header — non-browser client (SDK, curl, Go router)
        origin = request.headers.get("origin")
        if origin is None:
            return await call_next(request)

        # 4. Validate origin
        normalised_origin = origin.rstrip("/")
        allowed = _get_allowed_origins()

        if normalised_origin not in allowed:
            logger.warning(
                "CSRF origin rejected",
                extra={"origin": normalised_origin, "path": request.url.path},
            )
            return JSONResponse(
                status_code=403,
                content={
                    "error": {
                        "type": "csrf_error",
                        "message": "Origin not allowed",
                        "code": 403,
                    }
                },
            )

        return await call_next(request)
