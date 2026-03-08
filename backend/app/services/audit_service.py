"""Audit logging service — SOC2 compliant, append-only audit trail.

Usage:
    await audit_service.log(
        db=db,
        actor_id=str(user.id),
        action="api_key.create",
        resource_type="api_key",
        resource_id=str(key.id),
        team_id=str(team.id),
        details=json.dumps({"key_prefix": key.key_prefix}),
        request=request,  # optional, to capture IP
    )
"""

import json
import logging

from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from app.models.audit_log import AuditLog

logger = logging.getLogger("audit")

# Actions follow the pattern: {resource}.{verb}
# e.g.: user.login, user.register, api_key.create, project.update, etc.


async def log(
    db: AsyncSession,
    *,
    action: str,
    actor_id: str | None = None,
    actor_email: str | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    team_id: str | None = None,
    project_id: str | None = None,
    details: str | None = None,
    status: str = "success",
    request: Request | None = None,
) -> AuditLog:
    """Create an immutable audit log entry.

    This is fire-and-forget — errors are caught and logged,
    never propagated to the caller. Audit failures must not
    break business logic.
    """
    try:
        actor_ip = None
        if request is not None:
            # Extract real IP from proxy headers
            actor_ip = (
                request.headers.get("x-real-ip")
                or (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
                or (request.client.host if request.client else None)
            )

        entry = AuditLog(
            actor_id=actor_id,
            actor_email=actor_email,
            resource_type=resource_type,
            resource_id=resource_id,
            action=action,
            team_id=team_id,
            project_id=project_id,
            details=details,
            status=status,
            actor_ip=actor_ip,
        )
        db.add(entry)
        await db.flush()

        logger.info(
            "audit",
            extra={
                "action": action,
                "actor_id": actor_id,
                "resource_type": resource_type,
                "resource_id": resource_id,
                "status": status,
            },
        )
        return entry

    except Exception as exc:
        # Never let audit logging break the request
        logger.error("failed to write audit log: %s", exc)
        return None  # type: ignore[return-value]


async def log_auth_event(
    db: AsyncSession,
    *,
    action: str,
    user_id: str | None = None,
    email: str | None = None,
    status: str = "success",
    details: dict | None = None,
    request: Request | None = None,
) -> AuditLog | None:
    """Convenience wrapper for authentication events."""
    return await log(
        db,
        action=f"auth.{action}",
        actor_id=user_id,
        actor_email=email,
        resource_type="user",
        resource_id=user_id,
        status=status,
        details=json.dumps(details) if details else None,
        request=request,
    )
