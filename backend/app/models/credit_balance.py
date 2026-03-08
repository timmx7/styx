"""Credit balance model — Achilles (managed) mode credit tracking."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Integer, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base
from app.db.types import GUID


class CreditBalance(Base):
    __tablename__ = "credit_balances"

    id: Mapped[uuid.UUID] = mapped_column(
        GUID(), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    balance_cents: Mapped[int] = mapped_column(Integer, default=0)
    total_purchased_cents: Mapped[int] = mapped_column(Integer, default=0)
    total_consumed_cents: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
