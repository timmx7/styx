"""Project and team management endpoints.

Team creation now auto-adds the owner as a TeamMember(role="owner").
All team/project access queries check membership (not just Team.owner_id),
so members, admins, and owners can all see their teams and projects.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.deps import get_current_user, require_team_membership
from app.models.team import Team
from app.models.team_member import TeamMember
from app.models.project import Project
from app.models.user import User
from app.schemas import (
    CreateProjectRequest,
    CreateTeamRequest,
    ProjectResponse,
    AddProjectMemberRequest,
    ProjectMemberResponse,
    TeamResponse,
    UpdateProjectRequest,
)
from app.services.audit_service import log as audit_log
from app.utils import get_user_team_ids, get_user_project_ids

router = APIRouter(tags=["projects"])


# ─── Teams ──────────────────────────────────────────────────────────────

@router.post("/teams", response_model=TeamResponse, status_code=status.HTTP_201_CREATED)
async def create_team(
    body: CreateTeamRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Team:
    team = Team(name=body.name, owner_id=current_user.id)
    db.add(team)
    await db.flush()

    # Auto-add creator as owner member
    owner_member = TeamMember(
        team_id=team.id,
        user_id=current_user.id,
        role="owner",
    )
    db.add(owner_member)
    await db.flush()

    await audit_log(
        db, action="team.create", actor_id=str(current_user.id),
        actor_email=current_user.email, resource_type="team",
        resource_id=str(team.id), team_id=str(team.id), request=request,
    )

    return team


@router.get("/teams", response_model=list[TeamResponse])
async def list_teams(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[Team]:
    # Return all teams the user is a member of (owner, admin, or member)
    team_ids = await get_user_team_ids(str(current_user.id), db)
    if not team_ids:
        return []
    result = await db.execute(
        select(Team)
        .where(Team.id.in_(team_ids))
        .order_by(Team.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(result.scalars().all())


# ─── Projects ───────────────────────────────────────────────────────────

@router.post("/projects", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    body: CreateProjectRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Project:
    # Verify the user is at least admin on this team
    await require_team_membership(db, body.team_id, current_user.id, min_role="admin")

    project = Project(
        team_id=body.team_id,
        name=body.name,
        budget_monthly_cents=body.budget_monthly_cents,
        allowed_providers=body.allowed_providers,
        routing_strategy=body.routing_strategy,
    )
    db.add(project)
    await db.flush()

    await audit_log(
        db, action="project.create", actor_id=str(current_user.id),
        actor_email=current_user.email, resource_type="project",
        resource_id=str(project.id), team_id=str(body.team_id),
        project_id=str(project.id), request=request,
    )

    return project


@router.get("/projects", response_model=list[ProjectResponse])
async def list_projects(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[Project]:
    # Return projects the user has access to (via team owner/admin or explicit project membership)
    project_ids = await get_user_project_ids(str(current_user.id), db)
    if not project_ids:
        return []
    result = await db.execute(
        select(Project)
        .where(Project.id.in_(project_ids))
        .order_by(Project.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(result.scalars().all())


@router.get("/projects/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Project:
    from app.deps import require_project_access
    project = await require_project_access(db, project_id, current_user.id, min_role="viewer")
    return project


_PROJECT_UPDATE_ALLOWLIST = {
    "name",
    "budget_monthly_cents",
    "budget_alert_threshold_pct",
    "allowed_providers",
    "routing_strategy",
    "pii_redaction_enabled",
    "guardrails_config",
    "semantic_cache_enabled",
    "end_user_rate_limit",
}


@router.patch("/projects/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: str,
    body: UpdateProjectRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Project:
    """Update a project. Only whitelisted fields are accepted.

    Protected fields (id, team_id, created_at, etc.) cannot be modified.
    Requires at least 'admin' role on the project.
    """
    from app.deps import require_project_access
    project = await require_project_access(db, project_id, current_user.id, min_role="admin")

    update_data = body.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if key not in _PROJECT_UPDATE_ALLOWLIST:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Field '{key}' cannot be modified",
            )
        setattr(project, key, value)

    await db.flush()
    return project

# ─── Project Members ──────────────────────────────────────────────────

@router.get("/projects/{project_id}/members", response_model=list[ProjectMemberResponse])
async def list_project_members(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.deps import require_project_access
    from app.models.project_member import ProjectMember
    from sqlalchemy.orm import selectinload
    # Viewer can list members
    await require_project_access(db, project_id, current_user.id, min_role="viewer")

    result = await db.execute(
        select(ProjectMember)
        .where(ProjectMember.project_id == project_id)
        .options(selectinload(ProjectMember.user))
    )
    members = result.scalars().all()
    
    # We ideally return the email from the user relation
    return [
        {
            "id": m.id,
            "project_id": m.project_id,
            "user_id": m.user_id,
            "role": m.role,
            "user_email": m.user.email if m.user else None,
            "user_name": m.user.name if m.user else None,
            "created_at": m.created_at,
        }
        for m in members
    ]


@router.post("/projects/{project_id}/members", response_model=ProjectMemberResponse, status_code=status.HTTP_201_CREATED)
async def add_project_member(
    project_id: str,
    body: AddProjectMemberRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.deps import require_project_access
    from app.models.project_member import ProjectMember
    from sqlalchemy.exc import IntegrityError
    # Admin required to add user
    await require_project_access(db, project_id, current_user.id, min_role="admin")

    member = ProjectMember(
        project_id=project_id,
        user_id=body.user_id,
        role=body.role,
    )
    db.add(member)
    
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="User is already a member of this project")

    # Reload to get user relation
    result = await db.execute(select(ProjectMember).where(ProjectMember.id == member.id))
    m = result.scalar_one()

    await audit_log(
        db, action="project_member.add", actor_id=str(current_user.id),
        actor_email=current_user.email, resource_type="project_member",
        resource_id=str(m.id), project_id=project_id, request=request,
    )

    return {
        "id": m.id,
        "project_id": m.project_id,
        "user_id": m.user_id,
        "role": m.role,
        "user_email": m.user.email if m.user else None,
        "user_name": m.user.name if m.user else None,
        "created_at": m.created_at,
    }


@router.delete("/projects/{project_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_project_member(
    project_id: str,
    user_id: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.deps import require_project_access
    from app.models.project_member import ProjectMember
    
    is_self = str(current_user.id) == user_id
    if is_self:
        # One can leave a project without being admin
        await require_project_access(db, project_id, current_user.id, min_role="viewer")
    else:
        # Otherwise need admin
        await require_project_access(db, project_id, current_user.id, min_role="admin")

    result = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user_id,
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found in project")

    await db.delete(member)
    await db.flush()

    action = "project_member.leave" if is_self else "project_member.remove"
    await audit_log(
        db, action=action, actor_id=str(current_user.id),
        actor_email=current_user.email, resource_type="project",
        resource_id=project_id, project_id=project_id, request=request,
    )


@router.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a project and all its associated resources.

    Requires at least 'admin' role on the parent team.
    Cascades: API keys, provider keys, prompts, members, A/B tests.
    Routing logs are NOT deleted (kept for historical audit).
    """
    from app.deps import require_project_access
    from app.models.api_key import ApiKey
    from app.models.prompt import PromptTemplate

    project = await require_project_access(db, project_id, current_user.id, min_role="admin")
    team_id = str(project.team_id)

    # Delete records without cascade configured on the relationship
    api_keys = (await db.execute(
        select(ApiKey).where(ApiKey.project_id == project.id)
    )).scalars().all()
    for key in api_keys:
        await db.delete(key)

    prompts = (await db.execute(
        select(PromptTemplate).where(PromptTemplate.project_id == project.id)
    )).scalars().all()
    for prompt in prompts:
        await db.delete(prompt)

    await db.flush()

    # Delete the project itself (cascade handles provider_keys, members, ab_tests)
    await db.delete(project)
    await db.flush()

    await audit_log(
        db, action="project.delete", actor_id=str(current_user.id),
        actor_email=current_user.email, resource_type="project",
        resource_id=project_id, team_id=team_id,
        project_id=project_id, request=request,
    )


@router.get("/projects/{project_id}/end-users", response_model=list[dict])
async def get_project_end_users(
    project_id: str,
    period: str = Query("30d", pattern="^(1d|7d|30d|90d)$"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get analytics grouped by end_user_id from ClickHouse."""
    from app.deps import require_project_access
    from app.services import clickhouse_service
    
    await require_project_access(db, project_id, current_user.id, min_role="viewer")
    return await clickhouse_service.query_end_user_analytics(project_id, period)
