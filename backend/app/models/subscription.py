"""Subscription model — tracks user billing plan (Charon or Achilles)."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Integer, String, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base
from app.db.types import GUID


class Subscription(Base):
    __tablename__ = "subscriptions"

    id: Mapped[uuid.UUID] = mapped_column(
        GUID(), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    billing_mode: Mapped[str] = mapped_column(
        String(10), nullable=False,
        doc="'charon' (BYOK) or 'achilles' (managed)",
    )
    plan: Mapped[str] = mapped_column(
        String(20), nullable=False,
        doc="Plan name: shade/obol/ferryman/titan",
    )
    stripe_customer_id: Mapped[str | None] = mapped_column(String(255))
    stripe_subscription_id: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(
        String(20), default="active",
        doc="active, trialing, past_due, cancelled, incomplete",
    )
    current_period_start: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    current_period_end: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    requests_used: Mapped[int] = mapped_column(Integer, default=0)
    requests_limit: Mapped[int] = mapped_column(
        Integer, nullable=False,
        doc="Monthly request quota. -1 = unlimited.",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
