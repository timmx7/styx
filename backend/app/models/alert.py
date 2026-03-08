"""Alert SQLAlchemy model — stores budget/system alerts for projects."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, String, Integer, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base
from app.db.types import GUID


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[uuid.UUID] = mapped_column(
        GUID(), primary_key=True, default=uuid.uuid4
    )
    project_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    team_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    alert_type: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # "budget_warning", "budget_exceeded", "provider_down"
    severity: Mapped[str] = mapped_column(
        String(20), nullable=False, default="warning"
    )  # "info", "warning", "critical"
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_json: Mapped[str | None] = mapped_column(Text)  # JSON string of extra data
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    budget_cents: Mapped[int | None] = mapped_column(Integer)
    spent_cents: Mapped[int | None] = mapped_column(Integer)
    threshold_pct: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )
