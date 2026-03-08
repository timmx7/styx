"""Credit transaction ledger — Achilles (managed) mode transaction history."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Integer, String, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base
from app.db.types import GUID


class CreditTransaction(Base):
    __tablename__ = "credit_transactions"

    id: Mapped[uuid.UUID] = mapped_column(
        GUID(), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    type: Mapped[str] = mapped_column(
        String(20), nullable=False,
        doc="purchase, consumption, bonus, monthly_credit, refund",
    )
    amount_cents: Mapped[int] = mapped_column(
        Integer, nullable=False,
        doc="Positive = credit, negative = debit",
    )
    balance_after_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    description: Mapped[str | None] = mapped_column(String(500))
    request_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    stripe_payment_id: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        index=True,
    )
