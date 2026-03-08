"""Budget API endpoints — spend tracking and budget management."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.deps import get_current_user
from app.models.project import Project
from app.models.team import Team
from app.models.team_member import TeamMember
from app.models.user import User
from app.schemas import BudgetStatusResponse, UpdateBudgetRequest
from app.services import budget_service
from app.utils import get_user_team_ids

router = APIRouter(prefix="/budget", tags=["budget"])


@router.get("", response_model=list[BudgetStatusResponse])
async def list_budgets(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[BudgetStatusResponse]:
    """Get budget status for all of the user's projects."""
    team_ids = await get_user_team_ids(str(current_user.id), db)
    if not team_ids:
        return []

    result = await db.execute(
        select(Project, Team)
        .join(Team, Project.team_id == Team.id)
        .where(Team.id.in_(team_ids))
        .order_by(Project.created_at.desc())
        .limit(limit)
        .offset(offset)
    )

    statuses = []
    for row in result.all():
        project, team = row._tuple()
        budget_info = await budget_service.check_budget(
            str(project.id), project.budget_monthly_cents
        )
        statuses.append(
            BudgetStatusResponse(
                project_id=str(project.id),
                project_name=project.name,
                budget_cents=project.budget_monthly_cents,
                spent_cents=budget_info["spent_cents"],
                remaining_cents=budget_info["remaining_cents"],
                pct_used=budget_info["pct_used"],
                alert_threshold_pct=project.budget_alert_threshold_pct,
            )
        )
    return statuses


@router.put("/{project_id}")
async def update_budget(
    project_id: str,
    body: UpdateBudgetRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Update a project's budget settings. Requires admin+ access."""
    result = await db.execute(
        select(Project, Team)
        .join(Team, Project.team_id == Team.id)
        .join(TeamMember, TeamMember.team_id == Team.id)
        .where(
            Project.id == project_id,
            TeamMember.user_id == current_user.id,
            TeamMember.role.in_(["owner", "admin"]),
        )
    )
    row = result.first()
    if row is None:
        raise HTTPException(status_code=404, detail="Project not found")

    project, _ = row._tuple()
    project.budget_monthly_cents = body.budget_monthly_cents
    project.budget_alert_threshold_pct = body.budget_alert_threshold_pct
    await db.flush()

    return {"ok": True, "budget_monthly_cents": project.budget_monthly_cents}
