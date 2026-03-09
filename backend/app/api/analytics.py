"""Analytics API endpoints — usage stats, provider breakdown, daily trends, routing logs."""

from datetime import datetime, timedelta, timezone


from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy import case, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.deps import get_current_user
from app.models.routing_log import RoutingLog
from app.models.user import User
from app.schemas import RoutingLogResponse
from app.utils import get_user_project_ids
from app.services import clickhouse_service

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/overview")
async def analytics_overview(
    days: int = Query(30, ge=1, le=365),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Get analytics overview: total requests, avg latency, cache rate, etc."""
    project_ids = await get_user_project_ids(str(current_user.id), db)
    if not project_ids:
        return {
            "total_requests": 0,
            "avg_latency_ms": 0,
            "cache_hit_rate": 0.0,
            "fallback_rate": 0.0,
            "error_rate": 0.0,
            "period_days": days,
        }

    since = datetime.now(timezone.utc) - timedelta(days=days)

    # Aggregate count + avg latency (portable across PostgreSQL and SQLite)
    raw = await db.execute(
        select(
            func.count(RoutingLog.id),
            func.coalesce(func.avg(RoutingLog.latency_ms), 0),
        )
        .where(
            RoutingLog.project_id.in_(project_ids),
            RoutingLog.created_at >= since,
        )
    )
    row = raw.first()
    total = row[0] if row else 0
    avg_latency = round(float(row[1]), 1) if row and row[1] else 0

    # Cache hit count
    cache_result = await db.execute(
        select(func.count(RoutingLog.id))
        .where(
            RoutingLog.project_id.in_(project_ids),
            RoutingLog.created_at >= since,
            RoutingLog.cache_hit.is_(True),
        )
    )
    cache_hits = cache_result.scalar() or 0

    # Fallback count
    fallback_result = await db.execute(
        select(func.count(RoutingLog.id))
        .where(
            RoutingLog.project_id.in_(project_ids),
            RoutingLog.created_at >= since,
            RoutingLog.was_fallback.is_(True),
        )
    )
    fallbacks = fallback_result.scalar() or 0

    # Error count (status >= 400)
    error_result = await db.execute(
        select(func.count(RoutingLog.id))
        .where(
            RoutingLog.project_id.in_(project_ids),
            RoutingLog.created_at >= since,
            RoutingLog.status_code >= 400,
        )
    )
    errors = error_result.scalar() or 0

    return {
        "total_requests": total,
        "avg_latency_ms": avg_latency,
        "cache_hit_rate": round(cache_hits / total * 100, 1) if total > 0 else 0,
        "cache_hits": cache_hits,
        "fallback_rate": round(fallbacks / total * 100, 1) if total > 0 else 0,
        "error_rate": round(errors / total * 100, 1) if total > 0 else 0,
        "period_days": days,
    }


@router.get("/by-provider")
async def analytics_by_provider(
    days: int = Query(30, ge=1, le=365),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Get request breakdown by provider (single query — no N+1)."""
    project_ids = await get_user_project_ids(str(current_user.id), db)
    if not project_ids:
        return []

    since = datetime.now(timezone.utc) - timedelta(days=days)

    # Single query with conditional aggregation — fixes N+1 issue
    error_case = case(
        (RoutingLog.status_code >= 400, 1),
        else_=0,
    )
    result = await db.execute(
        select(
            RoutingLog.provider,
            func.count(RoutingLog.id).label("count"),
            func.coalesce(func.avg(RoutingLog.latency_ms), 0).label("avg_latency"),
            func.sum(error_case).label("error_count"),
        )
        .where(
            RoutingLog.project_id.in_(project_ids),
            RoutingLog.created_at >= since,
        )
        .group_by(RoutingLog.provider)
        .order_by(func.count(RoutingLog.id).desc())
    )

    return [
        {
            "provider": row[0],
            "request_count": row[1],
            "avg_latency_ms": round(float(row[2]), 1),
            "error_count": int(row[3] or 0),
            "error_rate": round(int(row[3] or 0) / row[1] * 100, 1) if row[1] > 0 else 0,
        }
        for row in result.all()
    ]


@router.get("/by-day")
async def analytics_by_day(
    days: int = Query(30, ge=1, le=365),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Get daily request counts for time-series charts."""
    project_ids = await get_user_project_ids(str(current_user.id), db)
    if not project_ids:
        return []

    since = datetime.now(timezone.utc) - timedelta(days=days)

    # Use func.date() which works on both PostgreSQL and SQLite
    day_expr = func.date(RoutingLog.created_at)

    result = await db.execute(
        select(
            day_expr.label("day"),
            func.count(RoutingLog.id).label("count"),
            func.coalesce(func.avg(RoutingLog.latency_ms), 0).label("avg_latency"),
        )
        .where(
            RoutingLog.project_id.in_(project_ids),
            RoutingLog.created_at >= since,
        )
        .group_by(day_expr)
        .order_by(day_expr)
    )

    return [
        {
            "date": str(row[0]),
            "request_count": row[1],
            "avg_latency_ms": round(float(row[2]), 1),
        }
        for row in result.all()
    ]


@router.get("/by-model")
async def analytics_by_model(
    days: int = Query(30, ge=1, le=365),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Get request breakdown by model."""
    project_ids = await get_user_project_ids(str(current_user.id), db)
    if not project_ids:
        return []

    since = datetime.now(timezone.utc) - timedelta(days=days)

    result = await db.execute(
        select(
            RoutingLog.model,
            RoutingLog.provider,
            func.count(RoutingLog.id).label("count"),
            func.coalesce(func.avg(RoutingLog.latency_ms), 0).label("avg_latency"),
        )
        .where(
            RoutingLog.project_id.in_(project_ids),
            RoutingLog.created_at >= since,
        )
        .group_by(RoutingLog.model, RoutingLog.provider)
        .order_by(func.count(RoutingLog.id).desc())
    )

    return [
        {
            "model": row[0],
            "provider": row[1],
            "request_count": row[2],
            "avg_latency_ms": round(float(row[3]), 1),
        }
        for row in result.all()
    ]


# ─── User-facing routing logs (for dashboard) ─────────────────────────

@router.get("/routing-logs", response_model=list[RoutingLogResponse])
async def get_routing_logs(
    limit: int = Query(50, le=200),
    project_id: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[RoutingLog]:
    """Get recent routing logs for the dashboard. Requires JWT auth."""
    project_ids = await get_user_project_ids(str(current_user.id), db)
    if not project_ids:
        return []

    query = select(RoutingLog).where(RoutingLog.project_id.in_(project_ids))

    if project_id and project_id in project_ids:
        query = query.where(RoutingLog.project_id == project_id)

    query = query.order_by(desc(RoutingLog.created_at)).limit(limit)

    result = await db.execute(query)
    return list(result.scalars().all())


@router.get("/projects/{project_id}/traces")
async def get_project_traces(
    project_id: str,
    limit: int = Query(50, le=200),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Get detailed routing traces from ClickHouse for a project."""
    project_ids = await get_user_project_ids(str(current_user.id), db)
    if project_id not in project_ids:
        # Return empty list if unauthorized
        return []

    traces = await clickhouse_service.query_traces(project_id, limit)
    return traces


@router.get("/projects/{project_id}/export-dataset")
async def export_project_dataset(
    project_id: str,
    limit: int = Query(5000, le=10000),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Exporting traces is no longer supported for privacy reasons (no request payloads stored)."""
    raise HTTPException(status_code=400, detail="Exporting datasets is disabled as request payloads are not stored for privacy.")
