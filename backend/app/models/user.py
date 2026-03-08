"""User SQLAlchemy model."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, String, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.db.types import GUID


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        GUID(), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    name: Mapped[str | None] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(50), default="user")
    stripe_customer_id: Mapped[str | None] = mapped_column(String(255))
    billing_mode: Mapped[str | None] = mapped_column(
        String(10), nullable=True, default=None,
        doc="'charon' (BYOK) or 'achilles' (managed). NULL = not yet chosen.",
    )

    # Email verification
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    email_verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    # Relationships
    teams = relationship("Team", back_populates="owner", lazy="selectin")
    team_memberships = relationship("TeamMember", back_populates="user", lazy="selectin")
    project_memberships = relationship("ProjectMember", back_populates="user", lazy="selectin")
