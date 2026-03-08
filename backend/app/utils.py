"""Utility functions shared across the backend."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


async def get_user_team_ids(user_id: str, db: AsyncSession) -> list[str]:
    """Get all team IDs for a user. Shared across alerts, analytics, budget."""
    from app.models.team_member import TeamMember
    result = await db.execute(
        select(TeamMember.team_id).where(TeamMember.user_id == user_id)
    )
    return [str(row[0]) for row in result.all()]


async def get_user_project_ids(user_id: str, db: AsyncSession) -> list[str]:
    """Get all project IDs the user has access to (via explicit ProjectMember or as Team owner/admin)."""
    from app.models.project import Project
    from app.models.team_member import TeamMember
    from app.models.project_member import ProjectMember
    from sqlalchemy import or_, and_, select

    # We need projects where:
    # team_id is in (teams where user is owner/admin)
    # OR id is in (projects where user is a member)
    
    stmt = (
        select(Project.id)
        .outerjoin(TeamMember, and_(TeamMember.team_id == Project.team_id, TeamMember.user_id == user_id))
        .outerjoin(ProjectMember, and_(ProjectMember.project_id == Project.id, ProjectMember.user_id == user_id))
        .where(
            or_(
                TeamMember.role.in_(("owner", "admin", "developer", "billing", "viewer", "member")),
                ProjectMember.id.is_not(None)
            )
        )
    )
    result = await db.execute(stmt)
    return [str(row[0]) for row in result.all()]


def mask_email(email: str) -> str:
    """Mask an email address for safe logging.

    Examples:
        john@example.com → j***@example.com
        ab@test.io → a***@test.io
        a@x.com → a***@x.com
    """
    if not email or "@" not in email:
        return "***"
    local, domain = email.rsplit("@", 1)
    if len(local) == 0:
        return f"***@{domain}"
    return f"{local[0]}***@{domain}"
