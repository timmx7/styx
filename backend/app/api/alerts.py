"""Alerts API endpoints — budget warnings and system alerts."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.deps import get_current_user
from app.models.user import User
from app.schemas import AlertResponse
from app.services import alert_service
from app.utils import get_user_team_ids

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("", response_model=list[AlertResponse])
async def list_alerts(
    limit: int = Query(50, le=200),
    unread_only: bool = False,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list:
    """Get alerts for the current user's teams."""
    team_ids = await get_user_team_ids(str(current_user.id), db)
    return await alert_service.get_alerts_for_user(
        db, team_ids, limit=limit, unread_only=unread_only
    )


@router.post("/{alert_id}/read")
async def mark_read(
    alert_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Mark a single alert as read. Verifies the user owns the alert's team."""
    team_ids = await get_user_team_ids(str(current_user.id), db)
    success = await alert_service.mark_alert_read(db, str(alert_id), team_ids)
    if not success:
        raise HTTPException(status_code=404, detail="Alert not found")
    return {"ok": True}


@router.post("/mark-all-read")
async def mark_all_read(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Mark all alerts as read."""
    team_ids = await get_user_team_ids(str(current_user.id), db)
    count = await alert_service.mark_all_read(db, team_ids)
    return {"marked_read": count}
