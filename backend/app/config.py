"""Application configuration loaded from environment variables."""

import logging
import secrets
import sys
import uuid

from cryptography.fernet import Fernet
from pydantic_settings import BaseSettings

_log = logging.getLogger("config")


class Settings(BaseSettings):
    # Database
    database_url: str = "postgresql+asyncpg://styx:styx@postgres:5432/styx"

    # Redis
    redis_url: str = "redis://redis:6379"

    # Auth
    jwt_secret: str = ""
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60  # 1 hour (short-lived, use refresh tokens)
    refresh_token_expire_days: int = 7

    # Stripe
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""

    # Security
    allowed_hosts: str = "*"  # comma-separated, e.g. "api.styx.ai,localhost"
    cors_origins: str = ""  # comma-separated, e.g. "https://app.styx.ai"
    max_request_body_bytes: int = 10 * 1024 * 1024  # 10 MB
    internal_secret: str = ""  # shared secret for router<->backend auth
    api_key_hmac_secret: str = ""  # HMAC secret for API key hashing

    # Supabase
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    supabase_webhook_secret: str = ""
    supabase_jwt_secret: str = ""  # Fallback for local dev (HS256)

    # Encryption (at-rest encryption for provider API keys)
    # Generate with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    encryption_key: str = ""  # Primary Fernet key (base64-encoded 32 bytes)
    encryption_key_previous: str = ""  # Previous key for seamless rotation

    # Email
    email_provider: str = "console"  # "console" (dev), "smtp", or "sendgrid"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_use_tls: bool = True
    sendgrid_api_key: str = ""
    email_from_address: str = "noreply@styx.ai"
    email_from_name: str = "Styx"

    # Frontend URL (used in email links)
    frontend_url: str = "http://localhost:3000"

    # Token expiration
    password_reset_token_expire_minutes: int = 60  # 1 hour
    email_verification_token_expire_hours: int = 24  # 24 hours
    team_invitation_expire_days: int = 7  # 7 days

    # ClickHouse
    clickhouse_url: str = ""
    clickhouse_user: str = "default"
    clickhouse_password: str = ""

    # Notifications
    slack_webhook_url: str = ""  # Slack incoming webhook URL for alerts
    notification_email: str = ""  # Email address for alert notifications

    # GitHub OAuth
    github_client_id: str = ""
    github_client_secret: str = ""

    # Feature flags
    enable_sso: bool = False  # SSO/SAML is mock-only — keep disabled until real python3-saml integration

    # Instance identity — unique ID for this Styx deployment
    # Auto-generated at first startup if not set via INSTANCE_ID env var.
    instance_id: str = ""

    # Dev mode — skip all authentication (NEVER use in production)
    skip_auth: bool = False

    # Server
    backend_port: int = 8000
    debug: bool = False

    model_config = {"env_prefix": "", "case_sensitive": False}

    @property
    def cookie_secure(self) -> bool:
        """Derive Secure flag from frontend URL — False for http:// (dev), True for https:// (prod)."""
        return self.frontend_url.startswith("https://")


settings = Settings()

# ─── Startup validation ─────────────────────────────────────────
_INSECURE_SECRETS = {
    "change-me-in-production-please",
    "dev-secret-change-in-production",
    "dev-internal-secret-change-in-production",
    "dev-hmac-secret-change-in-production",
    "",
}

if settings.skip_auth:
    # Dev mode: auto-generate any missing secrets so the app can start
    _log.warning(
        "\u26a0\ufe0f  SKIP_AUTH=true \u2014 all authentication is DISABLED. "
        "Do NOT use this in production!"
    )
    if settings.internal_secret in _INSECURE_SECRETS:
        settings.internal_secret = secrets.token_urlsafe(32)
    if not settings.api_key_hmac_secret or len(settings.api_key_hmac_secret) < 32:
        settings.api_key_hmac_secret = secrets.token_urlsafe(32)
    if not settings.encryption_key or len(settings.encryption_key) < 32:
        settings.encryption_key = Fernet.generate_key().decode()
    if not settings.jwt_secret:
        settings.jwt_secret = secrets.token_urlsafe(32)

elif not settings.debug:
    if settings.internal_secret in _INSECURE_SECRETS:
        _log.critical(
            "INTERNAL_SECRET is not set or is insecure. "
            "This secret is required for router<->backend authentication."
        )
        sys.exit(1)

    if not settings.api_key_hmac_secret or len(settings.api_key_hmac_secret) < 32:
        _log.critical("API_KEY_HMAC_SECRET must be at least 32 characters in production.")
        sys.exit(1)

    if not settings.encryption_key or len(settings.encryption_key) < 32:
        _log.critical("ENCRYPTION_KEY must be at least 32 characters in production.")
        sys.exit(1)
else:
    # In debug mode, generate random secrets if not provided
    if settings.jwt_secret in _INSECURE_SECRETS:
        settings.jwt_secret = secrets.token_urlsafe(32)
        _log.warning("Using auto-generated JWT_SECRET (debug mode)")

    if not settings.internal_secret:
        settings.internal_secret = secrets.token_urlsafe(32)
        _log.warning("Using auto-generated INTERNAL_SECRET (debug mode)")

    if not settings.api_key_hmac_secret:
        settings.api_key_hmac_secret = secrets.token_urlsafe(32)
        _log.warning("Using auto-generated API_KEY_HMAC_SECRET (debug mode)")

    if not settings.encryption_key:
        settings.encryption_key = Fernet.generate_key().decode()
        _log.warning("Using auto-generated ENCRYPTION_KEY (debug mode)")

# ── Instance ID auto-generation (runs in all modes) ─────────────
# If INSTANCE_ID is not set in the environment, generate a transient UUID.
# For stable IDs across restarts, set INSTANCE_ID in your .env (via setup.sh).
if not settings.instance_id:
    settings.instance_id = str(uuid.uuid4())
    _log.warning(
        "INSTANCE_ID not set — using transient UUID %s. "
        "Add INSTANCE_ID to .env for a stable identifier.",
        settings.instance_id,
    )
