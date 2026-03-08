"""Pytest configuration and shared fixtures for backend tests.

Uses an in-memory SQLite database with StaticPool so all async sessions
share the same in-memory database. All models use portable types (GUID,
PortableJSON, PortableArray) so no type patches are needed.
"""

import os
import uuid
from typing import AsyncGenerator

# ── Set ALL test environment FIRST ─────────────────────────────────
os.environ.update({
    "DATABASE_URL": "sqlite+aiosqlite://",
    "JWT_SECRET": "test-jwt-secret-for-unit-tests-only",
    "INTERNAL_SECRET": "test-internal-secret",
    "API_KEY_HMAC_SECRET": "test-hmac-secret",
    "ENCRYPTION_KEY": "eTtWOwW8IireWLrBy9ROVvRN438a0wnHd0K7DX0FIKw=",  # test Fernet key
    "REDIS_URL": "",
    "CLICKHOUSE_URL": "",
    "DEBUG": "true",
    "STRIPE_SECRET_KEY": "",
    "STRIPE_WEBHOOK_SECRET": "",
})

# ── Create test engine with StaticPool ─────────────────────────────
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

_test_engine = create_async_engine(
    "sqlite+aiosqlite://",
    echo=False,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
_test_session_factory = async_sessionmaker(
    _test_engine, class_=AsyncSession, expire_on_commit=False
)

# ── Patch the app database module BEFORE importing the app ─────────
import app.db.database as db_mod

db_mod.engine = _test_engine
db_mod.async_session = _test_session_factory

# ── Patch Redis with in-memory fake ────────────────────────────────


class _FakePipeline:
    """Minimal pipeline mock that collects operations and executes them."""

    def __init__(self, store: dict):
        self._store = store
        self._ops: list = []

    def incrby(self, key: str, amount: int):
        self._ops.append(("incrby", key, amount))
        return self

    def expire(self, key: str, seconds: int):
        self._ops.append(("expire", key, seconds))
        return self

    async def execute(self):
        results = []
        for op in self._ops:
            if op[0] == "incrby":
                _, key, amount = op
                val = int(self._store.get(key, 0)) + amount
                self._store[key] = str(val)
                results.append(val)
            elif op[0] == "expire":
                results.append(True)
        return results


class _FakeRedis:
    """Dict-backed async Redis mock for budget_service tests.

    Supports the Redis operations used by the application:
    - get/set/setex    -> key-value storage
    - exists           -> key existence check
    - incrby/expire    -> budget counters
    - pipeline         -> budget batch operations
    """

    def __init__(self):
        self._data: dict[str, str] = {}

    async def get(self, key: str):
        return self._data.get(key)

    async def set(self, key: str, value, *, ex=None, nx=False, **kw):
        """SET with optional NX (set-if-not-exists) and EX (expiry, ignored)."""
        if nx and key in self._data:
            return None  # key already exists, NX means don't overwrite
        self._data[key] = str(value)
        return True

    async def setex(self, key: str, seconds: int, value) -> None:
        """SET with EXpiration."""
        self._data[key] = str(value)
        # TTL is ignored in tests (no background eviction)

    async def exists(self, *keys: str) -> int:
        """Check how many of the given keys exist."""
        return sum(1 for k in keys if k in self._data)

    async def delete(self, *keys: str) -> int:
        """Delete keys — useful for test cleanup."""
        count = 0
        for k in keys:
            if k in self._data:
                del self._data[k]
                count += 1
        return count

    async def incrby(self, key: str, amount: int):
        val = int(self._data.get(key, 0)) + amount
        self._data[key] = str(val)
        return val

    async def expire(self, key: str, seconds: int):
        pass  # no-op

    def pipeline(self):
        return _FakePipeline(self._data)


_fake_redis = _FakeRedis()

import app.services.budget_service as _budget_mod

_budget_mod._redis_client = _fake_redis  # type: ignore[assignment]


async def _get_fake_redis():
    return _fake_redis

_budget_mod.get_redis = _get_fake_redis  # type: ignore[assignment]

# ── RSA test keypair for Supabase JWT validation in tests ─────────
from cryptography.hazmat.primitives.asymmetric import rsa as _rsa
from cryptography.hazmat.primitives import serialization as _ser
import jwt as _pyjwt
from datetime import datetime as _dt, timedelta as _td, timezone as _tz

_test_rsa_private = _rsa.generate_private_key(public_exponent=65537, key_size=2048)
_test_rsa_public = _test_rsa_private.public_key()

_test_rsa_private_pem = _test_rsa_private.private_bytes(
    _ser.Encoding.PEM, _ser.PrivateFormat.PKCS8, _ser.NoEncryption()
)
_test_rsa_public_pem = _test_rsa_public.public_bytes(
    _ser.Encoding.PEM, _ser.PublicFormat.SubjectPublicKeyInfo
)


def _make_test_jwt(user_id: str, email: str = "test@styx.dev", **extra) -> str:
    """Create an RS256 JWT signed with the test RSA key."""
    now = _dt.now(_tz.utc)
    payload = {
        "sub": user_id,
        "email": email,
        "aud": "authenticated",
        "exp": now + _td(hours=1),
        "iat": now,
        "role": "authenticated",
        **extra,
    }
    return _pyjwt.encode(payload, _test_rsa_private_pem, algorithm="RS256")


# Monkey-patch _decode_supabase_jwt so it accepts our test RSA keys.
import app.deps as _deps_mod

_original_decode = _deps_mod._decode_supabase_jwt


def _test_decode_supabase_jwt(token: str) -> dict:
    """Test-friendly JWT decoder: use test RSA key."""
    return _pyjwt.decode(
        token,
        _test_rsa_public_pem,
        algorithms=["RS256"],
        audience="authenticated",
        options={"require": ["sub", "exp"]},
    )


_deps_mod._decode_supabase_jwt = _test_decode_supabase_jwt

import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.db.database import Base, get_db
from app.main import app


@pytest_asyncio.fixture(scope="function")
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    """Create fresh tables for each test, then clean up."""
    async with _test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with _test_session_factory() as session:
        yield session

    async with _test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture(scope="function")
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """HTTP test client with overridden database dependency."""
    # Clear FakeRedis between tests so state doesn't leak
    _fake_redis._data.clear()

    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def registered_user(client: AsyncClient, db_session: AsyncSession) -> dict:
    """Create a user with team and project directly in the DB.

    Returns a dict with user_id, email, access_token (RS256 test JWT),
    team_id, and project_id.  The auth_headers fixture reads access_token.
    """
    from app.models.user import User
    from app.models.team import Team
    from app.models.team_member import TeamMember
    from app.models.project import Project

    email = f"test_{uuid.uuid4().hex[:8]}@styx.dev"
    user_id = uuid.uuid4()

    user = User(
        id=user_id,
        email=email,
        password_hash="supabase-managed",
        name="Test User",
        role="user",
        email_verified=True,
    )
    db_session.add(user)
    await db_session.flush()

    team = Team(name="Test User's Team", owner_id=user.id)
    db_session.add(team)
    await db_session.flush()

    membership = TeamMember(team_id=team.id, user_id=user.id, role="owner")
    db_session.add(membership)

    project = Project(team_id=team.id, name="Default Project")
    db_session.add(project)
    await db_session.flush()
    await db_session.commit()

    access_token = _make_test_jwt(str(user_id), email)

    return {
        "user_id": str(user_id),
        "email": email,
        "access_token": access_token,
        "team_id": str(team.id),
        "project_id": str(project.id),
    }


@pytest_asyncio.fixture
async def create_test_user(db_session: AsyncSession):
    """Factory fixture: call to create additional test users with team + project.

    Usage in tests::

        user_data = await create_test_user()
        # or with custom values:
        user_data = await create_test_user(email="custom@styx.dev", name="Custom")

    Returns dict with: user_id, email, access_token, team_id, project_id, headers.
    """
    from app.models.user import User
    from app.models.team import Team
    from app.models.team_member import TeamMember
    from app.models.project import Project

    async def _factory(
        email: str | None = None,
        name: str = "Test User",
        **extra,
    ) -> dict:
        email = email or f"user_{uuid.uuid4().hex[:8]}@styx.dev"
        user_id = uuid.uuid4()

        user = User(
            id=user_id,
            email=email,
            password_hash="supabase-managed",
            name=name,
            role="user",
            email_verified=True,
        )
        db_session.add(user)
        await db_session.flush()

        team = Team(name=f"{name}'s Team", owner_id=user.id)
        db_session.add(team)
        await db_session.flush()

        membership = TeamMember(team_id=team.id, user_id=user.id, role="owner")
        db_session.add(membership)

        project = Project(team_id=team.id, name="Default Project")
        db_session.add(project)
        await db_session.flush()
        await db_session.commit()

        access_token = _make_test_jwt(str(user_id), email)

        return {
            "user_id": str(user_id),
            "email": email,
            "access_token": access_token,
            "team_id": str(team.id),
            "project_id": str(project.id),
            "headers": {"Authorization": f"Bearer {access_token}"},
        }

    return _factory


@pytest_asyncio.fixture
async def auth_headers(registered_user: dict) -> dict:
    """Authorization headers for an authenticated user."""
    return {"Authorization": f"Bearer {registered_user['access_token']}"}


@pytest_asyncio.fixture
async def team_and_project(client: AsyncClient, auth_headers: dict) -> dict:
    """Use the auto-onboarded team and create a project in it.

    Since auto-onboarding creates a default team + project at registration,
    we reuse that team and add a test project with a budget.
    """
    # Get the auto-onboarded team (created during registration)
    teams_resp = await client.get("/api/teams", headers=auth_headers)
    assert teams_resp.status_code == 200, f"List teams failed: {teams_resp.text}"
    teams = teams_resp.json()
    assert len(teams) >= 1, "Expected at least 1 auto-onboarded team"
    team_id = teams[0]["id"]

    proj_resp = await client.post(
        "/api/projects",
        json={
            "name": "Test Project",
            "team_id": team_id,
            "budget_monthly_cents": 10000,
        },
        headers=auth_headers,
    )
    assert proj_resp.status_code in (200, 201), f"Project creation failed: {proj_resp.text}"
    project_id = proj_resp.json()["id"]

    return {"team_id": team_id, "project_id": project_id}
