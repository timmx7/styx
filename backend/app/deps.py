"""Shared FastAPI dependencies — Supabase JWT validation + token blacklist."""

import logging
import uuid
from datetime import datetime, timedelta, timezone

import jwt as pyjwt
import redis.asyncio as aioredis
from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select, and_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.database import get_db
from app.models.user import User
from app.models.team_member import TeamMember

logger = logging.getLogger("deps")

security = HTTPBearer(auto_error=False)

# ─── Token blacklist (Redis) ─────────────────────────────────────
_blacklist_redis: aioredis.Redis | None = None


async def _get_blacklist_redis() -> aioredis.Redis | None:
    """Lazy-init Redis client for token blacklist."""
    global _blacklist_redis
    if _blacklist_redis is None:
        try:
            _blacklist_redis = aioredis.from_url(
                settings.redis_url, decode_responses=True, socket_timeout=2
            )
            await _blacklist_redis.ping()
        except Exception:
            logger.warning("Redis unavailable for token blacklist")
            _blacklist_redis = None
    return _blacklist_redis


async def blacklist_token(jti: str, ttl_seconds: int) -> None:
    """Add a JTI to the Redis blacklist with TTL matching token expiry."""
    r = await _get_blacklist_redis()
    if r is None:
        logger.warning("cannot blacklist token: Redis unavailable")
        return
    try:
        await r.set(f"token_blacklist:{jti}", "1", ex=ttl_seconds)
    except Exception:
        logger.exception("failed to blacklist token %s", jti)


async def is_token_blacklisted(jti: str) -> bool:
    """Check if a JTI has been blacklisted (i.e., user logged out)."""
    r = await _get_blacklist_redis()
    if r is None:
        return False  # Redis down = fail open (token still valid)
    try:
        return await r.exists(f"token_blacklist:{jti}") > 0
    except Exception:
        return False

# Grace period: new users can use the API for 24 hours without verifying email
_EMAIL_VERIFICATION_GRACE_HOURS = 24

# ─── JWKS cache (fetched once per process) ──────────────────────────
_jwks_client: pyjwt.PyJWKClient | None = None


def _get_jwks_client() -> pyjwt.PyJWKClient | None:
    """Return a cached PyJWKClient for the Supabase project, or None if not configured."""
    global _jwks_client
    if _jwks_client is not None:
        return _jwks_client
    if settings.supabase_url:
        jwks_url = f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
        _jwks_client = pyjwt.PyJWKClient(jwks_url, cache_keys=True)
        return _jwks_client
    return None


def _decode_supabase_jwt(token: str) -> dict:
    """Decode a Supabase-issued JWT.

    Tries in order:
    1. RS256 via JWKS (production Supabase tokens)
    2. HS256 with supabase_jwt_secret (local dev / Supabase CLI)

    Raises jwt.InvalidTokenError on failure.
    """
    errors: list[Exception] = []

    # 1. JWKS (supports RS256 + ES256 — Supabase migrated to ES256 in 2025)
    client = _get_jwks_client()
    if client is not None:
        try:
            signing_key = client.get_signing_key_from_jwt(token)
            payload = pyjwt.decode(
                token,
                signing_key.key,
                algorithms=["RS256", "ES256"],
                audience="authenticated",
                options={"require": ["sub", "exp"]},
            )
            return payload
        except Exception as exc:
            errors.append(exc)

    # 2. HS256 with supabase_jwt_secret
    if settings.supabase_jwt_secret:
        try:
            payload = pyjwt.decode(
                token,
                settings.supabase_jwt_secret,
                algorithms=["HS256"],
                audience="authenticated",
                options={"require": ["sub", "exp"]},
            )
            return payload
        except Exception as exc:
            errors.append(exc)

    # All strategies failed
    if errors:
        raise errors[-1]
    raise pyjwt.InvalidTokenError("No JWT secret configured")


async def _auto_create_user(
    supabase_uid: uuid.UUID,
    email: str,
    db: AsyncSession,
    *,
    team_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
) -> User:
    """Create a local User row (+ default Team & Project) for a Supabase user.

    This handles the race condition where a Supabase signup webhook hasn't
    arrived yet but the user's JWT is already valid.

    Optional ``team_id`` / ``project_id`` allow dev-mode callers to pin the
    IDs so they match what the Go router expects (SKIP_AUTH flow).
    """
    from app.models.team import Team
    from app.models.project import Project

    user = User(
        id=supabase_uid,
        email=email,
        password_hash=None,
        name=email.split("@")[0],
        role="user",
        email_verified=True,
    )
    db.add(user)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        result = await db.execute(select(User).where(User.id == supabase_uid))
        return result.scalar_one()

    team_kwargs: dict = {"name": f"{user.name}'s Team", "owner_id": user.id}
    if team_id is not None:
        team_kwargs["id"] = team_id
    team = Team(**team_kwargs)
    db.add(team)
    await db.flush()

    member = TeamMember(team_id=team.id, user_id=user.id, role="owner")
    db.add(member)

    project_kwargs: dict = {"team_id": team.id, "name": "Default Project"}
    if project_id is not None:
        project_kwargs["id"] = project_id
    project = Project(**project_kwargs)
    db.add(project)

    await db.commit()
    await db.refresh(user)
    logger.info("auto-created user %s (%s) with team + project", supabase_uid, email)
    return user


async def _ensure_dev_fixtures(
    db: AsyncSession,
    user: User,
    team_id: uuid.UUID,
    project_id: uuid.UUID,
) -> None:
    """Ensure the dev Team & Project expected by the Go router exist.

    Called when the dev user already exists but the database may have been
    created before the IDs were pinned (team/project have random UUIDs).
    Without the matching project, /internal/log-usage returns 404 and no
    request stats appear in the dashboard.
    """
    from app.models.team import Team
    from app.models.project import Project

    result = await db.execute(select(Project.id).where(Project.id == project_id))
    if result.scalar_one_or_none() is not None:
        return  # Already present

    # Ensure the dev team exists
    result = await db.execute(select(Team.id).where(Team.id == team_id))
    if result.scalar_one_or_none() is None:
        db.add(Team(id=team_id, name="Dev Team", owner_id=user.id))
        await db.flush()
        db.add(TeamMember(team_id=team_id, user_id=user.id, role="owner"))

    db.add(Project(id=project_id, team_id=team_id, name="Dev Project"))
    await db.commit()
    logger.info("created dev fixtures: team=%s project=%s", team_id, project_id)


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Decode JWT and return the authenticated User, or raise 401.

    Also enforces email verification after a 24-hour grace period:
    if email_verified is False and the account is older than 24 hours,
    raises 403 "Please verify your email".
    """
    # ── Dev mode: skip auth entirely, return a fixed dev user ──
    # These IDs must match the Go router's SKIP_AUTH KeyInfo (validator.go).
    if settings.skip_auth:
        dev_uid = uuid.UUID("00000000-0000-0000-0000-000000000001")
        dev_team_id = uuid.UUID("00000000-0000-0000-0000-000000000003")
        dev_project_id = uuid.UUID("00000000-0000-0000-0000-000000000002")

        result = await db.execute(select(User).where(User.id == dev_uid))
        user = result.scalar_one_or_none()
        if user is None:
            user = await _auto_create_user(
                dev_uid, "dev@styx.local", db,
                team_id=dev_team_id, project_id=dev_project_id,
            )
        else:
            # Existing DB — ensure the dev project the Go router logs to exists.
            await _ensure_dev_fixtures(db, user, dev_team_id, dev_project_id)
        return user

    token = None
    if credentials is not None:
        token = credentials.credentials
    elif request.cookies.get("access_token"):
        token = request.cookies.get("access_token")

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        payload = _decode_supabase_jwt(token)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    # Check token blacklist (logout revocation)
    jti = payload.get("jti") or payload.get("session_id") or payload.get("sub")
    if jti and await is_token_blacklisted(jti):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has been revoked",
        )

    user_id = payload.get("sub")

    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )

    try:
        user_uuid = uuid.UUID(user_id)
    except (ValueError, AttributeError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )

    result = await db.execute(select(User).where(User.id == user_uuid))
    user = result.scalar_one_or_none()

    # Auto-create user if Supabase webhook hasn't arrived yet
    if user is None:
        email = payload.get("email", "")
        if not email:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found",
            )
        try:
            user = await _auto_create_user(user_uuid, email, db)
        except Exception:
            logger.exception("auto-create user failed for %s", user_uuid)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found",
            )

    # Enforce email verification after the grace period.
    # New users get 24 hours to test the API without verifying their email.
    if not user.email_verified:
        created = user.created_at
        # Handle both timezone-aware (PostgreSQL) and naive (SQLite/test) datetimes
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        grace_deadline = created + timedelta(hours=_EMAIL_VERIFICATION_GRACE_HOURS)
        if datetime.now(timezone.utc) > grace_deadline:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Please verify your email",
            )

    return user


# ─── Shared team / project access helpers ─────────────────────────

_ROLE_HIERARCHY = {"owner": 5, "admin": 4, "developer": 3, "member": 2, "billing": 2, "viewer": 1}


async def get_team_membership(
    db: AsyncSession, team_id, user_id,
) -> TeamMember | None:
    """Return the TeamMember record for a user in a team, or None."""
    result = await db.execute(
        select(TeamMember).where(
            and_(
                TeamMember.team_id == team_id,
                TeamMember.user_id == user_id,
            )
        )
    )
    return result.scalar_one_or_none()


async def require_team_membership(
    db: AsyncSession, team_id, user_id, *, min_role: str = "viewer",
) -> TeamMember:
    """Return the membership or raise 403/404.

    min_role hierarchy: owner > admin > developer > member = billing > viewer
    """
    member = await get_team_membership(db, team_id, user_id)
    if member is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Team not found or you are not a member",
        )

    if _ROLE_HIERARCHY.get(member.role, 0) < _ROLE_HIERARCHY.get(min_role, 0):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Requires at least '{min_role}' role",
        )

    return member


async def get_project_membership(
    db: AsyncSession, project_id, user_id,
):
    """Return the ProjectMember record for a user in a project, or None."""
    from app.models.project_member import ProjectMember
    result = await db.execute(
        select(ProjectMember).where(
            and_(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id == user_id,
            )
        )
    )
    return result.scalar_one_or_none()


async def require_project_access(
    db: AsyncSession, project_id: str, user_id, *, min_role: str = "viewer",
):
    """Verify user has at least min_role access to the project.

    Users have access if:
    1. They are an 'owner' or 'admin' of the parent team.
    2. OR they are explicitly a 'ProjectMember' with at least min_role.

    Returns the Project on success, or raises 404/403.
    """
    from app.models.project import Project

    # 1. Fetch the project
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()

    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found or you don't have access",
        )

    # 2. Check team membership (owner/admin have global access, other team members fallback)
    team_member = await get_team_membership(db, project.team_id, user_id)
    if team_member and team_member.role in ("owner", "admin"):
        return project

    # 3. Check explicit project membership
    project_member = await get_project_membership(db, project_id, user_id)

    # If no explicit project membership, fallback to team membership role if they are in the team
    active_role = None
    if project_member:
        active_role = project_member.role
    elif team_member:
        # Regular team members can view projects but not edit them (viewer role)
        # Developers can edit project settings (developer)
        active_role = team_member.role if team_member.role in ("developer", "member", "viewer") else "viewer"

    if not active_role:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found or you don't have access",
        )

    project_role_hierarchy = {"admin": 4, "developer": 3, "member": 2, "billing": 2, "viewer": 1}

    if project_role_hierarchy.get(active_role, 0) < project_role_hierarchy.get(min_role, 0):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Requires at least '{min_role}' role on this project",
        )

    return project
