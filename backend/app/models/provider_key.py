"""Provider API Key model — stores encrypted provider credentials.

Each project can have one key per provider (e.g., one OpenAI key, one Anthropic key).
Keys are encrypted at rest using Fernet (AES-128-CBC + HMAC-SHA256).

The key_ciphertext column NEVER contains a plaintext key — only the encrypted
version prefixed with "v1:" for versioning.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import String, DateTime, ForeignKey, UniqueConstraint, Boolean, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.db.types import GUID


class ProviderKey(Base):
    __tablename__ = "provider_keys"
    __table_args__ = (
        UniqueConstraint("project_id", "provider", name="uq_project_provider"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        GUID(), primary_key=True, default=uuid.uuid4
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    provider: Mapped[str] = mapped_column(
        String(50), nullable=False,
        comment="Provider name: openai, anthropic, google, mistral, azure",
    )
    key_ciphertext: Mapped[str] = mapped_column(
        Text, nullable=False,
        comment="Fernet-encrypted provider API key (v1:<token>)",
    )
    key_hint: Mapped[str] = mapped_column(
        String(20), nullable=False,
        comment="Last 4 chars of the plaintext key for display (e.g., '...abc1')",
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    rotated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        comment="When the key was last rotated (re-encrypted with new value)",
    )

    # Relationships
    project = relationship("Project", back_populates="provider_keys", lazy="selectin")
