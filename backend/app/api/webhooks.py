"""Webhook CRUD API endpoints — manage HTTP callback subscriptions."""

import json
import secrets
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.deps import get_current_user
from app.models.user import User
from app.models.webhook import WebhookEndpoint, WebhookDelivery
from app.schemas import (
    CreateWebhookEndpointRequest,
    MessageResponse,
    UpdateWebhookEndpointRequest,
    WebhookEndpointCreatedResponse,
    WebhookEndpointResponse,
    WebhookDeliveryResponse,
)
from app.services import audit_service
from app.services.webhook_service import fire_event
from app.utils import get_user_team_ids

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


# ─── Helpers ────────────────────────────────────────────────────────────


async def _verify_team_membership(
    user: User, team_ids: list[str], team_id: str
) -> None:
    """Raise 403 if the user is not a member of the given team."""
    if str(team_id) not in team_ids:
        raise HTTPException(
            status_code=403,
            detail="You are not a member of this team",
        )


async def _get_webhook_or_404(
    webhook_id: uuid.UUID, team_ids: list[str], db: AsyncSession
) -> WebhookEndpoint:
    """Fetch a webhook and verify it belongs to one of the user's teams."""
    result = await db.execute(
        select(WebhookEndpoint).where(
            WebhookEndpoint.id == webhook_id,
            WebhookEndpoint.team_id.in_(team_ids),
        )
    )
    webhook = result.scalar_one_or_none()
    if webhook is None:
        raise HTTPException(status_code=404, detail="Webhook not found")
    return webhook


# ─── Endpoints ──────────────────────────────────────────────────────────


@router.post("", response_model=WebhookEndpointCreatedResponse, status_code=201)
async def create_webhook(
    body: CreateWebhookEndpointRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WebhookEndpointCreatedResponse:
    """Create a new webhook. The secret is returned ONLY in this response."""
    team_ids = await get_user_team_ids(str(current_user.id), db)
    await _verify_team_membership(current_user, team_ids, str(body.team_id))

    secret = secrets.token_urlsafe(32)

    webhook = WebhookEndpoint(
        team_id=body.team_id,
        url=str(body.url),
        secret=secret,
        events=body.events,
        is_active=True,
        description=body.description,
        consecutive_failures=0,
    )
    db.add(webhook)
    await db.flush()

    await audit_service.log(
        db,
        action="webhook.create",
        actor_id=str(current_user.id),
        resource_type="webhook",
        resource_id=str(webhook.id),
        team_id=str(body.team_id),
        details=json.dumps({"url": body.url, "events": body.events}),
        request=request,
    )

    return WebhookEndpointCreatedResponse(
        id=webhook.id,
        team_id=webhook.team_id,
        url=webhook.url,
        secret=secret,
        events=webhook.events or [],
        is_active=webhook.is_active,
        description=webhook.description,
        last_triggered_at=webhook.last_triggered_at,
        consecutive_failures=webhook.consecutive_failures,
        created_at=webhook.created_at,
    )


@router.get("", response_model=list[WebhookEndpointResponse])
async def list_webhooks(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[WebhookEndpointResponse]:
    """List all webhooks for the current user's teams."""
    team_ids = await get_user_team_ids(str(current_user.id), db)
    if not team_ids:
        return []

    result = await db.execute(
        select(WebhookEndpoint)
        .where(WebhookEndpoint.team_id.in_(team_ids))
        .order_by(WebhookEndpoint.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    webhooks = result.scalars().all()
    return [
        WebhookEndpointResponse(
            id=wh.id,
            team_id=wh.team_id,
            url=wh.url,
            events=wh.events or [],
            is_active=wh.is_active,
            description=wh.description,
            last_triggered_at=wh.last_triggered_at,
            consecutive_failures=wh.consecutive_failures,
            created_at=wh.created_at,
        )
        for wh in webhooks
    ]


@router.get("/{webhook_id}", response_model=WebhookEndpointResponse)
async def get_webhook(
    webhook_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WebhookEndpointResponse:
    """Get a single webhook by ID."""
    team_ids = await get_user_team_ids(str(current_user.id), db)
    webhook = await _get_webhook_or_404(webhook_id, team_ids, db)
    return WebhookEndpointResponse(
        id=webhook.id,
        team_id=webhook.team_id,
        url=webhook.url,
        events=webhook.events or [],
        is_active=webhook.is_active,
        description=webhook.description,
        last_triggered_at=webhook.last_triggered_at,
        consecutive_failures=webhook.consecutive_failures,
        created_at=webhook.created_at,
    )


@router.put("/{webhook_id}", response_model=WebhookEndpointResponse)
async def update_webhook(
    webhook_id: uuid.UUID,
    body: UpdateWebhookEndpointRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WebhookEndpointResponse:
    """Update a webhook's settings (URL, events, description, active status)."""
    team_ids = await get_user_team_ids(str(current_user.id), db)
    webhook = await _get_webhook_or_404(webhook_id, team_ids, db)

    changes: dict[str, str] = {}

    if body.url is not None:
        changes["url"] = f"{webhook.url} -> {body.url}"
        webhook.url = str(body.url)
    if body.events is not None:
        changes["events"] = json.dumps(body.events)
        webhook.events = body.events
    if body.description is not None:
        changes["description"] = body.description
        webhook.description = body.description
    if body.is_active is not None:
        changes["is_active"] = f"{webhook.is_active} -> {body.is_active}"
        webhook.is_active = body.is_active
        # Reset failure counter when re-enabling
        if body.is_active:
            webhook.consecutive_failures = 0

    webhook.updated_at = datetime.now(timezone.utc)
    await db.flush()

    await audit_service.log(
        db,
        action="webhook.update",
        actor_id=str(current_user.id),
        resource_type="webhook",
        resource_id=str(webhook.id),
        team_id=str(webhook.team_id),
        details=json.dumps(changes) if changes else None,
        request=request,
    )

    return WebhookEndpointResponse(
        id=webhook.id,
        team_id=webhook.team_id,
        url=webhook.url,
        events=webhook.events or [],
        is_active=webhook.is_active,
        description=webhook.description,
        last_triggered_at=webhook.last_triggered_at,
        consecutive_failures=webhook.consecutive_failures,
        created_at=webhook.created_at,
    )


@router.delete("/{webhook_id}", response_model=MessageResponse)
async def delete_webhook(
    webhook_id: uuid.UUID,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """Delete a webhook permanently."""
    team_ids = await get_user_team_ids(str(current_user.id), db)
    webhook = await _get_webhook_or_404(webhook_id, team_ids, db)

    await audit_service.log(
        db,
        action="webhook.delete",
        actor_id=str(current_user.id),
        resource_type="webhook",
        resource_id=str(webhook.id),
        team_id=str(webhook.team_id),
        details=json.dumps({"url": webhook.url}),
        request=request,
    )

    await db.delete(webhook)
    await db.flush()

    return MessageResponse(message="Webhook deleted")


@router.post("/{webhook_id}/test", response_model=MessageResponse)
async def test_webhook(
    webhook_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """Send a test event to the webhook to verify it is reachable."""
    team_ids = await get_user_team_ids(str(current_user.id), db)
    webhook = await _get_webhook_or_404(webhook_id, team_ids, db)

    if not webhook.is_active:
        raise HTTPException(
            status_code=400,
            detail="Cannot test an inactive webhook. Re-enable it first.",
        )

    delivered = await fire_event(
        db,
        team_id=str(webhook.team_id),
        event="webhook.test",
        data={
            "webhook_id": str(webhook.id),
            "message": "This is a test event from Styx.",
        },
    )

    if delivered > 0:
        return MessageResponse(message="Test event delivered successfully")
    else:
        raise HTTPException(
            status_code=502,
            detail="Test event delivery failed. Check the webhook URL and try again.",
        )


@router.get("/{webhook_id}/deliveries", response_model=list[WebhookDeliveryResponse])
async def list_webhook_deliveries(
    webhook_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[WebhookDeliveryResponse]:
    """Get the recent delivery history for an endpoint."""
    team_ids = await get_user_team_ids(str(current_user.id), db)
    await _get_webhook_or_404(webhook_id, team_ids, db)

    result = await db.execute(
        select(WebhookDelivery)
        .where(WebhookDelivery.endpoint_id == webhook_id)
        .order_by(WebhookDelivery.created_at.desc())
        .limit(limit)
    )
    deliveries = result.scalars().all()
    
    return [
        WebhookDeliveryResponse(
            id=d.id,
            endpoint_id=d.endpoint_id,
            event_type=d.event_type,
            payload=d.payload,
            response_status=d.response_status,
            response_body=d.response_body,
            success=d.success,
            created_at=d.created_at,
        )
        for d in deliveries
    ]
