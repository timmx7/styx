"""ProjectMember SQLAlchemy model — tracks who has explicit access to a specific project.

Roles within a project:
  - owner   → inherit from Team (cannot be explicitly set here usually)
  - admin   → can manage project settings and keys
  - viewer  → can only view analytics and traces
  - developer → default role, can view analytics, keys, and traces
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.db.types import GUID


class ProjectMember(Base):
    __tablename__ = "project_members"

    # Composite uniqueness: one membership per user per project
    __table_args__ = (
        UniqueConstraint("project_id", "user_id", name="uq_project_members_project_user"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        GUID(), primary_key=True, default=uuid.uuid4
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(
        String(20), nullable=False, default="developer"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    # Relationships
    project = relationship("Project", back_populates="members", lazy="selectin")
    user = relationship("User", back_populates="project_memberships", lazy="selectin")
