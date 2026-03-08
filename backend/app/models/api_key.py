"""API Key SQLAlchemy model."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import String, Integer, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.db.types import GUID, PortableJSON


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[uuid.UUID] = mapped_column(
        GUID(), primary_key=True, default=uuid.uuid4
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("projects.id"), nullable=False
    )
    key_hash: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    key_prefix: Mapped[str] = mapped_column(String(20), nullable=False)
    name: Mapped[str | None] = mapped_column(String(255))
    permissions: Mapped[dict] = mapped_column(PortableJSON(), default=dict)
    rate_limit_per_minute: Mapped[int] = mapped_column(Integer, default=60)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    # Relationships
    project = relationship("Project", back_populates="api_keys", lazy="selectin")
