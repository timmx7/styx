"""API key management endpoints."""

import logging
import os

import json
import redis.asyncio as aioredis

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger("keys")

# Lazy Redis client for publishing key revocation events
_revoke_redis: aioredis.Redis | None = None


async def _get_revoke_redis() -> aioredis.Redis | None:
    """Get or create a Redis client for key revocation pub/sub."""
    global _revoke_redis
    if _revoke_redis is None:
        url = os.getenv("REDIS_URL", "redis://redis:6379")
        try:
            _revoke_redis = aioredis.from_url(url, decode_responses=True)
        except Exception as e:
            logger.warning("Failed to create Redis client for key revocation: %s", e)
            return None
    return _revoke_redis

from app.db.database import get_db
from app.deps import get_current_user, require_project_access
from app.models.api_key import ApiKey
from app.models.project import Project
from app.models.team import Team
from app.models.team_member import TeamMember
from app.models.user import User
from app.schemas import ApiKeyListItem, ApiKeyResponse, CreateApiKeyRequest
from app.services.audit_service import log as audit_log
from app.services.key_service import generate_api_key
from app.utils import get_user_team_ids

router = APIRouter(prefix="/keys", tags=["keys"])


@router.post("", response_model=ApiKeyResponse, status_code=status.HTTP_201_CREATED)
async def create_api_key(
    body: CreateApiKeyRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Create a new API key for a project. The plain key is returned only once."""
    # Verify the user has admin+ access to the project's team
    await require_project_access(db, str(body.project_id), current_user.id, min_role="admin")

    plain_key, key_hash, key_prefix = generate_api_key()

    api_key = ApiKey(
        project_id=body.project_id,
        key_hash=key_hash,
        key_prefix=key_prefix,
        name=body.name,
        rate_limit_per_minute=body.rate_limit_per_minute,
    )
    db.add(api_key)
    await db.flush()

    logger.info("api_key_created", extra={
        "user_id": str(current_user.id),
        "project_id": str(body.project_id),
        "key_prefix": key_prefix,
    })
    await audit_log(
        db, action="api_key.create", actor_id=str(current_user.id),
        actor_email=current_user.email, resource_type="api_key",
        resource_id=str(api_key.id), project_id=str(body.project_id),
        details=json.dumps({"key_prefix": key_prefix, "name": body.name}),
        request=request,
    )

    return {
        "id": api_key.id,
        "project_id": api_key.project_id,
        "key": plain_key,
        "key_prefix": key_prefix,
        "name": api_key.name,
        "rate_limit_per_minute": api_key.rate_limit_per_minute,
        "is_active": api_key.is_active,
        "created_at": api_key.created_at,
    }


@router.get("", response_model=list[ApiKeyListItem])
async def list_api_keys(
    project_id: str | None = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ApiKey]:
    """List API keys. Optionally filter by project_id. Never returns the plain key."""
    team_ids = await get_user_team_ids(str(current_user.id), db)
    if not team_ids:
        return []

    query = (
        select(ApiKey)
        .join(Project, ApiKey.project_id == Project.id)
        .where(Project.team_id.in_(team_ids))
    )
    if project_id:
        query = query.where(ApiKey.project_id == project_id)

    query = query.order_by(ApiKey.created_at.desc()).limit(limit).offset(offset)
    result = await db.execute(query)
    return list(result.scalars().all())


@router.delete("/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_api_key(
    key_id: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Revoke (deactivate) an API key. Requires admin+ access."""
    result = await db.execute(
        select(ApiKey)
        .join(Project, ApiKey.project_id == Project.id)
        .join(Team, Project.team_id == Team.id)
        .join(TeamMember, TeamMember.team_id == Team.id)
        .where(
            ApiKey.id == key_id,
            TeamMember.user_id == current_user.id,
            TeamMember.role.in_(["owner", "admin"]),
        )
    )
    api_key = result.scalar_one_or_none()
    if api_key is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="API key not found",
        )

    api_key.is_active = False
    await db.flush()
    await db.commit()

    # Publish revocation event to Redis AFTER commit so the Go router
    # only invalidates its cache once the DB state is durable.
    try:
        r = await _get_revoke_redis()
        if r is not None:
            await r.publish("styx:key_revoked", key_id)
            logger.info("key_revocation_published", extra={"key_id": key_id})
    except Exception as e:
        # Non-fatal: worst case the router cache expires after 30s TTL
        logger.warning("Failed to publish key revocation to Redis: %s", e)

    logger.info("api_key_revoked", extra={
        "user_id": str(current_user.id),
        "key_id": key_id,
        "key_prefix": api_key.key_prefix,
    })
    await audit_log(
        db, action="api_key.revoke", actor_id=str(current_user.id),
        actor_email=current_user.email, resource_type="api_key",
        resource_id=key_id, details=json.dumps({"key_prefix": api_key.key_prefix}),
        request=request,
    )
