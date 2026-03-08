"""TeamInvitation SQLAlchemy model — token-based invitation flow.

Flow:
  1. Owner/admin invites by email → token sent via email
  2. Recipient clicks link → POST /api/teams/{id}/invitations/accept
  3. On accept → TeamMember row created, invitation marked accepted
  4. On decline → invitation marked declined (no TeamMember)

Status values:
  - pending   → waiting for recipient action
  - accepted  → invitation accepted, user is now a team member
  - declined  → recipient declined the invitation
  - cancelled → inviter (owner/admin) cancelled the invitation
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import String, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.db.types import GUID


class TeamInvitation(Base):
    __tablename__ = "team_invitations"

    id: Mapped[uuid.UUID] = mapped_column(
        GUID(), primary_key=True, default=uuid.uuid4
    )
    team_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("teams.id", ondelete="CASCADE"), nullable=False, index=True
    )
    invited_email: Mapped[str] = mapped_column(
        String(255), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(
        String(20), nullable=False, default="member"
    )
    token_hash: Mapped[str] = mapped_column(
        String(255), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending"
    )
    invited_by_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    # Relationships
    team = relationship("Team", back_populates="invitations", lazy="selectin")
    invited_by = relationship("User", lazy="selectin")
