"""Provider key management endpoints — store, list, rotate, delete.

All provider API keys are encrypted at rest using Fernet (AES-128-CBC + HMAC-SHA256).
The plaintext key is NEVER stored in the database or returned in API responses.

Endpoints:
  POST   /provider-keys/{project_id}                     → Store a provider key
  GET    /provider-keys/{project_id}                     → List configured providers
  DELETE /provider-keys/{project_id}/{provider}           → Remove a provider key
  PUT    /provider-keys/{project_id}/{provider}/rotate    → Rotate a provider key

Access control:
  - owner  → everything
  - admin  → everything
  - member → list only (read)
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.deps import get_current_user, require_project_access
from app.models.provider_key import ProviderKey
from app.models.user import User
from app.schemas import (
    ProviderKeyListResponse,
    ProviderKeyResponse,
    RotateProviderKeyRequest,
    SetProviderKeyRequest,
    VALID_PROVIDERS,
)
from app.services.crypto_service import encrypt

logger = logging.getLogger("audit")

router = APIRouter(prefix="/provider-keys", tags=["provider-keys"])


# _require_project_access is now shared via deps.py
_require_project_access = require_project_access


def _make_key_hint(plaintext_key: str) -> str:
    """Create a display hint from the last 4 chars: '...abc1'."""
    if len(plaintext_key) <= 4:
        return "..." + ("*" * len(plaintext_key))
    return "..." + plaintext_key[-4:]


# ─── Store a provider key ─────────────────────────────────────────

@router.post("/{project_id}", response_model=ProviderKeyResponse, status_code=201)
async def set_provider_key(
    project_id: str,
    body: SetProviderKeyRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Store a provider API key (encrypted at rest). Requires admin+ role.

    If a key for this provider already exists, it will be replaced (rotated).
    """
    await _require_project_access(db, project_id, current_user.id, min_role="admin")

    # Encrypt the key
    ciphertext = encrypt(body.api_key)
    key_hint = _make_key_hint(body.api_key)

    # Check if a key already exists for this provider
    result = await db.execute(
        select(ProviderKey).where(
            and_(
                ProviderKey.project_id == project_id,
                ProviderKey.provider == body.provider,
            )
        )
    )
    existing = result.scalar_one_or_none()

    if existing is not None:
        # Rotate: update existing key
        existing.key_ciphertext = ciphertext
        existing.key_hint = key_hint
        existing.is_active = True
        existing.rotated_at = datetime.now(timezone.utc)
        await db.flush()

        logger.info("provider_key_rotated", extra={
            "user_id": str(current_user.id),
            "project_id": project_id,
            "provider": body.provider,
        })

        return existing

    # Create new key
    provider_key = ProviderKey(
        project_id=project_id,
        provider=body.provider,
        key_ciphertext=ciphertext,
        key_hint=key_hint,
    )
    db.add(provider_key)
    await db.flush()

    logger.info("provider_key_created", extra={
        "user_id": str(current_user.id),
        "project_id": project_id,
        "provider": body.provider,
    })

    return provider_key


# ─── List configured provider keys ────────────────────────────────

@router.get("/{project_id}", response_model=ProviderKeyListResponse)
async def list_provider_keys(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all configured provider keys for a project. Never returns plaintext keys."""
    await _require_project_access(db, project_id, current_user.id, min_role="member")

    result = await db.execute(
        select(ProviderKey).where(
            and_(
                ProviderKey.project_id == project_id,
                ProviderKey.is_active.is_(True),
            )
        )
    )
    keys = list(result.scalars().all())
    providers_configured = [k.provider for k in keys]

    return ProviderKeyListResponse(
        keys=keys,
        providers_configured=providers_configured,
        providers_available=sorted(VALID_PROVIDERS),
    )


# ─── Delete a provider key ────────────────────────────────────────

@router.delete("/{project_id}/{provider}", status_code=204)
async def delete_provider_key(
    project_id: str,
    provider: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove a provider key. Requires admin+ role."""
    if provider not in VALID_PROVIDERS:
        raise HTTPException(status_code=422, detail="Invalid provider")
    await _require_project_access(db, project_id, current_user.id, min_role="admin")

    result = await db.execute(
        select(ProviderKey).where(
            and_(
                ProviderKey.project_id == project_id,
                ProviderKey.provider == provider,
            )
        )
    )
    pk = result.scalar_one_or_none()
    if pk is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No key configured for provider '{provider}'",
        )

    await db.delete(pk)
    await db.flush()

    logger.info("provider_key_deleted", extra={
        "user_id": str(current_user.id),
        "project_id": project_id,
        "provider": provider,
    })


# ─── Rotate a provider key ────────────────────────────────────────

@router.put("/{project_id}/{provider}/rotate", response_model=ProviderKeyResponse)
async def rotate_provider_key(
    project_id: str,
    provider: str,
    body: RotateProviderKeyRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Rotate a provider key — re-encrypt with a new value. Requires admin+ role."""
    if provider not in VALID_PROVIDERS:
        raise HTTPException(status_code=422, detail="Invalid provider")
    await _require_project_access(db, project_id, current_user.id, min_role="admin")

    result = await db.execute(
        select(ProviderKey).where(
            and_(
                ProviderKey.project_id == project_id,
                ProviderKey.provider == provider,
            )
        )
    )
    pk = result.scalar_one_or_none()
    if pk is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No key configured for provider '{provider}'",
        )

    pk.key_ciphertext = encrypt(body.new_api_key)
    pk.key_hint = _make_key_hint(body.new_api_key)
    pk.rotated_at = datetime.now(timezone.utc)
    await db.flush()

    logger.info("provider_key_rotated", extra={
        "user_id": str(current_user.id),
        "project_id": project_id,
        "provider": provider,
    })

    return pk
