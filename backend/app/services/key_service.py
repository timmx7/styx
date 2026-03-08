"""API key generation and validation service.

Keys are generated as: sk_styx_{32 random hex chars}
Only the HMAC-SHA256 hash is stored in the database. The plain key is returned
once at creation time and never stored.

Security:
  - Production: requires API_KEY_HMAC_SECRET (enforced by config.py at startup)
  - Dev: auto-generated secret or SHA-256 fallback with warning
"""

import hashlib
import hmac
import logging
import secrets

from app.config import settings

logger = logging.getLogger("key_service")

_hmac_fallback_warned = False


def generate_api_key() -> tuple[str, str, str]:
    """Generate a new API key.

    Returns:
        tuple of (plain_key, key_hash, key_prefix)
    """
    random_part = secrets.token_hex(32)
    plain_key = f"sk_styx_{random_part}"
    key_hash = hash_api_key(plain_key)
    key_prefix = plain_key[:15]  # "sk_styx_abcdef" for display
    return plain_key, key_hash, key_prefix


def hash_api_key(plain_key: str) -> str:
    """HMAC-SHA256 hash of an API key for secure storage.

    Uses a server-side secret to prevent rainbow table attacks.
    In production, API_KEY_HMAC_SECRET is required (enforced at startup).
    In dev, falls back to SHA-256 with a warning.
    """
    global _hmac_fallback_warned

    hmac_secret = settings.api_key_hmac_secret
    if hmac_secret:
        return hmac.new(
            hmac_secret.encode(),
            plain_key.encode(),
            hashlib.sha256,
        ).hexdigest()

    if not _hmac_fallback_warned:
        logger.warning(
            "API_KEY_HMAC_SECRET not set — using plain SHA-256 (insecure, dev only). "
            "Set API_KEY_HMAC_SECRET in production."
        )
        _hmac_fallback_warned = True

    return hashlib.sha256(plain_key.encode()).hexdigest()
