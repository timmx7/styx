"""Tests for Supabase JWT validation in deps.py.

Uses its OWN RSA keypair (separate from conftest) to verify that the
monkey-patched _decode_supabase_jwt correctly validates RS256 tokens.
"""

import uuid
from datetime import datetime, timedelta, timezone

import jwt as pyjwt
import pytest
import pytest_asyncio
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

# ── Generate a SEPARATE RSA keypair for this test module ──────────
_private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_public_key = _private_key.public_key()

_private_pem = _private_key.private_bytes(
    serialization.Encoding.PEM,
    serialization.PrivateFormat.PKCS8,
    serialization.NoEncryption(),
)
_public_pem = _public_key.public_bytes(
    serialization.Encoding.PEM,
    serialization.PublicFormat.SubjectPublicKeyInfo,
)


def _make_jwt(
    user_id: str,
    email: str = "supabase@styx.dev",
    *,
    expired: bool = False,
    **extra,
) -> str:
    """Create an RS256 JWT signed with this module's private key."""
    now = datetime.now(timezone.utc)
    if expired:
        exp = now - timedelta(hours=1)
        iat = now - timedelta(hours=2)
    else:
        exp = now + timedelta(hours=1)
        iat = now
    payload = {
        "sub": user_id,
        "email": email,
        "aud": "authenticated",
        "exp": exp,
        "iat": iat,
        "role": "authenticated",
        **extra,
    }
    return pyjwt.encode(payload, _private_pem, algorithm="RS256")


@pytest.fixture(autouse=True)
def _patch_decode(monkeypatch):
    """Monkey-patch _decode_supabase_jwt to accept THIS module's RSA key."""
    import app.deps as deps_mod

    def _test_decode(token: str) -> dict:
        return pyjwt.decode(
            token,
            _public_pem,
            algorithms=["RS256"],
            audience="authenticated",
            options={"require": ["sub", "exp"]},
        )

    monkeypatch.setattr(deps_mod, "_decode_supabase_jwt", _test_decode)


@pytest.mark.asyncio
async def test_valid_supabase_jwt_returns_user(
    client: AsyncClient, db_session: AsyncSession
):
    """A valid RS256 JWT for an existing user returns 200 on a protected endpoint."""
    from app.models.user import User

    user_id = uuid.uuid4()
    email = f"supa_{uuid.uuid4().hex[:6]}@styx.dev"

    # Seed a user in the DB
    user = User(
        id=user_id,
        email=email,
        password_hash="supabase-managed",
        name="Supa User",
        role="user",
        email_verified=True,
    )
    db_session.add(user)
    await db_session.commit()

    token = _make_jwt(str(user_id), email)
    resp = await client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["email"] == email


@pytest.mark.asyncio
async def test_expired_supabase_jwt_returns_401(client: AsyncClient):
    """An expired RS256 JWT is rejected with 401."""
    token = _make_jwt(str(uuid.uuid4()), expired=True)
    resp = await client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_missing_user_auto_creates_row(
    client: AsyncClient, db_session: AsyncSession
):
    """If the user doesn't exist in the DB, auto-create with Team + Project."""
    from app.models.user import User
    from sqlalchemy import select

    user_id = uuid.uuid4()
    email = f"newuser_{uuid.uuid4().hex[:6]}@styx.dev"

    # Verify user does NOT exist
    result = await db_session.execute(select(User).where(User.id == user_id))
    assert result.scalar_one_or_none() is None

    token = _make_jwt(str(user_id), email)
    resp = await client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["email"] == email

    # Verify user was auto-created in the DB
    result = await db_session.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    assert user is not None
    assert user.email == email
    assert user.email_verified is True
