"""Secure token generation and hashing utilities.

Tokens are generated with ``secrets.token_urlsafe(32)`` (256 bits of entropy)
and hashed with HMAC-SHA256 for safe storage. Used by team invitations and
other features that need one-time-use tokens.
"""

import hashlib
import hmac
import secrets

from app.config import settings


def generate_token() -> str:
    """Generate a cryptographically secure URL-safe token (256 bits)."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """HMAC-SHA256 hash a token using the API key HMAC secret.

    We reuse ``api_key_hmac_secret`` because it's already a strong,
    securely generated secret in the config. If the DB is compromised,
    the hashed tokens are useless without this secret.
    """
    return hmac.new(
        settings.api_key_hmac_secret.encode("utf-8"),
        token.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
