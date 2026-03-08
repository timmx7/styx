"""TeamMember SQLAlchemy model — tracks who belongs to which team and their role.

Roles:
  - owner   → full control, can delete team, transfer ownership
  - admin   → can invite/remove members, manage projects, but cannot delete team
  - member  → read + use projects, cannot manage members
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.db.types import GUID


class TeamMember(Base):
    __tablename__ = "team_members"

    # Composite uniqueness: one membership per user per team
    __table_args__ = (
        UniqueConstraint("team_id", "user_id", name="uq_team_members_team_user"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        GUID(), primary_key=True, default=uuid.uuid4
    )
    team_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("teams.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(
        String(20), nullable=False, default="member"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    # Relationships
    team = relationship("Team", back_populates="members", lazy="selectin")
    user = relationship("User", back_populates="team_memberships", lazy="selectin")
