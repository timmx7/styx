"""Team SQLAlchemy model."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import String, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.db.types import GUID


class Team(Base):
    __tablename__ = "teams"

    id: Mapped[uuid.UUID] = mapped_column(
        GUID(), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id"), nullable=False
    )
    plan: Mapped[str] = mapped_column(String(50), default="shade")
    stripe_subscription_id: Mapped[str | None] = mapped_column(String(255))
    subscription_status: Mapped[str | None] = mapped_column(
        String(50), nullable=True, default=None,
        doc="Stripe subscription status synced via webhook (active, past_due, canceled, etc.)",
    )
    current_period_end: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None,
        doc="End of the current billing period, synced via Stripe webhook.",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    # Relationships
    # Relationships
    owner = relationship("User", back_populates="teams", lazy="selectin")
    projects = relationship("Project", back_populates="team", lazy="selectin")
    members = relationship("TeamMember", back_populates="team", lazy="selectin")
    invitations = relationship("TeamInvitation", back_populates="team", lazy="selectin")
    identity_provider = relationship("IdentityProvider", back_populates="team", uselist=False, lazy="selectin", cascade="all, delete-orphan")
