"""Audit log model for SOC2 compliance.

Records every significant action taken on the platform:
- User authentication events (login, logout, register)
- API key creation, revocation
- Project/team changes
- Budget changes
- Provider key management
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Index, String, Text

from app.db.database import Base
from app.db.types import GUID


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)

    # Who performed the action
    actor_id = Column(GUID(), nullable=True, index=True)  # null for system events
    actor_email = Column(String(255), nullable=True)  # denormalized for fast queries
    actor_ip = Column(String(45), nullable=True)  # IPv4 or IPv6

    # What happened
    action = Column(String(100), nullable=False, index=True)  # e.g. "user.login", "api_key.create"
    resource_type = Column(String(50), nullable=True)  # e.g. "user", "api_key", "project"
    resource_id = Column(String(255), nullable=True)  # the affected resource ID

    # Context
    team_id = Column(GUID(), nullable=True, index=True)
    project_id = Column(GUID(), nullable=True)
    details = Column(Text, nullable=True)  # JSON string with additional context (no PII!)

    # Outcome
    status = Column(String(20), nullable=False, default="success")  # "success", "failure", "denied"

    # Timestamp (immutable — audit logs are append-only)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        index=True,
    )

    __table_args__ = (
        Index("ix_audit_action_created", "action", "created_at"),
        Index("ix_audit_team_created", "team_id", "created_at"),
    )
