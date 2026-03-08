"""006 – Add audit_logs table for SOC2 compliance.

Revision ID: 006
Create Date: 2026-02-15
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "006"
down_revision = "005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "audit_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=True, index=True),
        sa.Column("actor_email", sa.String(255), nullable=True),
        sa.Column("actor_ip", sa.String(45), nullable=True),
        sa.Column("action", sa.String(100), nullable=False, index=True),
        sa.Column("resource_type", sa.String(50), nullable=True),
        sa.Column("resource_id", sa.String(255), nullable=True),
        sa.Column("team_id", postgresql.UUID(as_uuid=True), nullable=True, index=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("details", sa.Text, nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="success"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
            index=True,
        ),
    )
    # Composite indexes for common query patterns
    op.create_index("ix_audit_action_created", "audit_logs", ["action", "created_at"])
    op.create_index("ix_audit_team_created", "audit_logs", ["team_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_audit_team_created", table_name="audit_logs")
    op.drop_index("ix_audit_action_created", table_name="audit_logs")
    op.drop_table("audit_logs")
