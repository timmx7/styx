"""Cryptographic service for at-rest encryption of sensitive data.

Uses Fernet symmetric encryption (AES-128-CBC + HMAC-SHA256):
  - Confidentiality: AES-128-CBC encrypts the data
  - Integrity: HMAC-SHA256 prevents tampering
  - Versioned: Each ciphertext includes a version byte for future migration
  - Timestamped: Fernet includes encryption timestamp (enables TTL checks)

Key management:
  - Primary key: ENCRYPTION_KEY env var (Fernet-compatible, base64-encoded 32 bytes)
  - Rotation: ENCRYPTION_KEY_PREVIOUS allows seamless key rotation
  - All new writes use the primary key; reads try primary, then previous

Usage:
    from app.services.crypto_service import encrypt, decrypt

    ciphertext = encrypt("sk-abc123...")
    plaintext = decrypt(ciphertext)
"""


from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from app.config import settings


def _get_fernet() -> Fernet | MultiFernet:
    """Build the Fernet instance from configured keys.

    If both primary and previous keys exist, returns MultiFernet
    (decrypts with either key, encrypts only with primary).
    """
    primary_key = settings.encryption_key
    if not primary_key:
        raise RuntimeError(
            "ENCRYPTION_KEY is not configured. "
            "Generate one with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
        )

    fernets = [Fernet(primary_key.encode())]

    previous_key = settings.encryption_key_previous
    if previous_key:
        fernets.append(Fernet(previous_key.encode()))

    if len(fernets) == 1:
        return fernets[0]
    return MultiFernet(fernets)


def encrypt(plaintext: str) -> str:
    """Encrypt a plaintext string, returning a URL-safe base64 ciphertext.

    The returned string is safe to store in VARCHAR/TEXT columns.
    Includes version prefix for future migration.

    Args:
        plaintext: The sensitive value to encrypt (e.g., an API key)

    Returns:
        Ciphertext string like "v1:<fernet_token>"
    """
    if not plaintext:
        raise ValueError("Cannot encrypt empty string")

    f = _get_fernet()
    token = f.encrypt(plaintext.encode("utf-8"))
    return f"v1:{token.decode('ascii')}"


def decrypt(ciphertext: str) -> str:
    """Decrypt a ciphertext string back to plaintext.

    Handles versioned ciphertext format. If a previous key is configured,
    tries both keys (primary first, then previous).

    Args:
        ciphertext: The encrypted value from the database

    Returns:
        The original plaintext string

    Raises:
        ValueError: If the ciphertext is malformed or cannot be decrypted
    """
    if not ciphertext:
        raise ValueError("Cannot decrypt empty string")

    # Strip version prefix
    if ciphertext.startswith("v1:"):
        token = ciphertext[3:]
    else:
        # Legacy format (no version prefix) — treat as raw Fernet token
        token = ciphertext

    f = _get_fernet()
    try:
        return f.decrypt(token.encode("ascii")).decode("utf-8")
    except InvalidToken:
        raise ValueError(
            "Failed to decrypt: invalid token or wrong encryption key. "
            "If you recently rotated keys, ensure ENCRYPTION_KEY_PREVIOUS "
            "is set to the old key."
        )


def generate_encryption_key() -> str:
    """Generate a new Fernet-compatible encryption key.

    Returns a URL-safe base64-encoded 32-byte key.
    Use this to generate ENCRYPTION_KEY values.
    """
    return Fernet.generate_key().decode("ascii")


def is_encrypted(value: str) -> bool:
    """Check if a value appears to be an encrypted ciphertext."""
    if not value:
        return False
    return value.startswith("v1:") and len(value) > 50


async def rotate_encryption_keys() -> dict:
    """Re-encrypt all provider keys with the current primary encryption key.

    This should be run after rotating ENCRYPTION_KEY:
      1. Set ENCRYPTION_KEY to the new key
      2. Set ENCRYPTION_KEY_PREVIOUS to the old key
      3. Run this function to re-encrypt all stored keys
      4. Once complete, ENCRYPTION_KEY_PREVIOUS can be removed

    The function:
      - Loads all ProviderKey rows from the database
      - Decrypts each key_ciphertext (MultiFernet tries primary, then previous)
      - Re-encrypts with the current primary key
      - Updates the row in the database

    Returns:
        {"total": int, "rotated": int, "failed": int, "errors": list[str]}
    """
    import logging
    from datetime import datetime, timezone

    from sqlalchemy import select

    from app.db.database import async_session
    from app.models.provider_key import ProviderKey

    logger = logging.getLogger("crypto_service")

    stats = {"total": 0, "rotated": 0, "failed": 0, "errors": []}

    async with async_session() as db:
        result = await db.execute(select(ProviderKey))
        all_keys = list(result.scalars().all())
        stats["total"] = len(all_keys)

        for pk in all_keys:
            try:
                # Decrypt with MultiFernet (tries primary, then previous key)
                plaintext = decrypt(pk.key_ciphertext)
                # Re-encrypt with the current primary key only
                new_ciphertext = encrypt(plaintext)
                pk.key_ciphertext = new_ciphertext
                pk.rotated_at = datetime.now(timezone.utc)
                stats["rotated"] += 1
            except (ValueError, Exception) as exc:
                msg = f"Failed to rotate key {pk.id} (provider={pk.provider}): {exc}"
                logger.error(msg)
                stats["errors"].append(msg)
                stats["failed"] += 1

        await db.commit()

    logger.info(
        "encryption key rotation complete",
        extra={
            "total": stats["total"],
            "rotated": stats["rotated"],
            "failed": stats["failed"],
        },
    )
    return stats
