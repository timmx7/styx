"""Auth endpoints: /me, PATCH /me (billing mode), logout, Supabase webhook.

All authentication is handled by Supabase Auth. This module only exposes:
- GET  /auth/me              -> return current user profile
- PATCH /auth/me             -> set billing mode (one-shot)
- POST /auth/logout          -> blacklist current JWT in Redis
- POST /auth/supabase-webhook -> handle Supabase user.created / user.updated events
"""

import hmac as hmac_mod
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Header, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.database import get_db
from app.deps import get_current_user, _decode_supabase_jwt, blacklist_token
from app.models.user import User
from app.schemas import UserResponse
from app.schemas_billing import SetBillingModeRequest

logger = logging.getLogger("auth")

router = APIRouter(prefix="/auth", tags=["auth"])


# --- GET /me ---------------------------------------------------------------

@router.get("/me", response_model=UserResponse)
async def me(current_user: User = Depends(get_current_user)) -> User:
    """Return the currently authenticated user."""
    return current_user


# --- PATCH /me (set billing mode) ------------------------------------------

@router.patch("/me", response_model=UserResponse)
async def set_billing_mode(
    body: SetBillingModeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """One-shot: choose billing mode (charon or achilles).

    Once set, billing_mode cannot be changed. For Charon users, a free
    'shade' subscription with 10K requests/month is automatically created.
    """
    if current_user.billing_mode is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Billing mode already set to '{current_user.billing_mode}'",
        )

    current_user.billing_mode = body.billing_mode
    current_user.updated_at = datetime.now(timezone.utc)

    # Auto-create shade subscription for Charon (free plan, immediate start)
    if body.billing_mode == "charon":
        from app.models.subscription import Subscription
        from app.schemas_billing import CHARON_PLANS

        shade = CHARON_PLANS["shade"]
        sub = Subscription(
            user_id=current_user.id,
            billing_mode="charon",
            plan="shade",
            status="active",
            requests_used=0,
            requests_limit=shade["requests_limit"],
        )
        db.add(sub)

    await db.flush()
    await db.commit()
    await db.refresh(current_user)

    logger.info(
        "billing mode set",
        extra={"user_id": str(current_user.id), "mode": body.billing_mode},
    )

    return current_user


# --- POST /logout -----------------------------------------------------------

@router.post("/logout", status_code=status.HTTP_200_OK)
async def logout(request: Request, response: Response) -> dict:
    """Invalidate the current JWT by blacklisting its JTI in Redis.

    Reads the token from Authorization header or access_token cookie.
    After logout, subsequent requests with this token will return 401.
    """
    # Extract token from header or cookie
    token = None
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
    elif request.cookies.get("access_token"):
        token = request.cookies.get("access_token")

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    # Decode token to get JTI and expiration
    try:
        payload = _decode_supabase_jwt(token)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    jti = payload.get("jti") or payload.get("session_id") or payload.get("sub")
    exp = payload.get("exp")

    if not jti:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Token has no JTI — cannot revoke",
        )

    # Calculate TTL: blacklist until the token naturally expires
    if exp:
        ttl = max(int(exp - datetime.now(timezone.utc).timestamp()), 60)
    else:
        ttl = 3600  # default 1 hour

    await blacklist_token(jti, ttl)

    # Clear cookies
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")

    logger.info("user logged out", extra={"sub": payload.get("sub"), "jti": jti})

    return {"status": "ok", "message": "Logged out successfully"}


# --- POST /supabase-webhook ------------------------------------------------

@router.post("/supabase-webhook", status_code=status.HTTP_200_OK)
async def supabase_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
    x_webhook_secret: str | None = Header(None),
) -> dict:
    """Handle Supabase Auth webhook events (user.created, user.updated).

    Supabase sends a webhook on sign-up and profile changes. We use this
    to ensure a local User row (+ default Team & Project) exists.

    Security: validates X-Webhook-Secret header against SUPABASE_WEBHOOK_SECRET.
    """
    expected_secret = settings.supabase_webhook_secret
    if not expected_secret:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Supabase webhook secret not configured",
        )

    if not hmac_mod.compare_digest(x_webhook_secret or "", expected_secret):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid webhook secret",
        )

    body = await request.json()
    event_type = body.get("type", "")
    record = body.get("record", {})

    supabase_uid = record.get("id")
    email = record.get("email")

    if not supabase_uid or not email:
        logger.warning("supabase webhook missing id or email: %s", event_type)
        return {"status": "ignored", "reason": "missing id or email"}

    if event_type == "INSERT":
        # user.created -- provision local user + team + project
        import uuid
        from app.models.team import Team
        from app.models.team_member import TeamMember
        from app.models.project import Project

        try:
            parsed_uid = uuid.UUID(supabase_uid)
        except (ValueError, AttributeError):
            logger.warning("supabase webhook INSERT: invalid UUID: %s", supabase_uid)
            return {"status": "ignored", "reason": "invalid user id"}

        # Check if user already exists (race condition with auto-create in deps.py)
        result = await db.execute(select(User).where(User.id == parsed_uid))
        existing = result.scalar_one_or_none()
        if existing:
            logger.info("supabase webhook INSERT: user %s already exists", supabase_uid)
            return {"status": "ok", "action": "already_exists"}

        user = User(
            id=parsed_uid,
            email=email,
            password_hash=None,
            name=record.get("raw_user_meta_data", {}).get("name", email.split("@")[0]),
            role="user",
            email_verified=record.get("email_confirmed_at") is not None,
        )
        db.add(user)
        await db.flush()

        team = Team(name=f"{user.name}'s Team", owner_id=user.id)
        db.add(team)
        await db.flush()

        membership = TeamMember(team_id=team.id, user_id=user.id, role="owner")
        db.add(membership)

        project = Project(team_id=team.id, name="Default Project")
        db.add(project)

        await db.commit()
        logger.info("supabase webhook: provisioned user %s with team + project", supabase_uid)
        return {"status": "ok", "action": "created"}

    elif event_type == "UPDATE":
        # user.updated -- sync email / verification status
        import uuid

        try:
            parsed_uid = uuid.UUID(supabase_uid)
        except (ValueError, AttributeError):
            logger.warning("supabase webhook UPDATE: invalid UUID: %s", supabase_uid)
            return {"status": "ignored", "reason": "invalid user id"}

        result = await db.execute(select(User).where(User.id == parsed_uid))
        user = result.scalar_one_or_none()
        if not user:
            logger.warning("supabase webhook UPDATE: user %s not found", supabase_uid)
            return {"status": "ignored", "reason": "user not found"}

        changed = False
        if email and user.email != email:
            user.email = email
            changed = True
        if record.get("email_confirmed_at") and not user.email_verified:
            user.email_verified = True
            user.email_verified_at = datetime.now(timezone.utc)
            changed = True

        if changed:
            user.updated_at = datetime.now(timezone.utc)
            await db.commit()
            logger.info("supabase webhook: updated user %s", supabase_uid)

        return {"status": "ok", "action": "updated" if changed else "no_change"}

    else:
        logger.debug("supabase webhook: ignoring event type %s", event_type)
        return {"status": "ignored", "reason": f"unhandled event type: {event_type}"}
