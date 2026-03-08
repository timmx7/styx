"""007 – Add webhooks table.

Revision ID: 007
Create Date: 2026-02-15
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "007"
down_revision = "006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "webhooks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "team_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("teams.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("url", sa.String(2048), nullable=False),
        sa.Column("secret", sa.String(255), nullable=False),
        sa.Column("events", postgresql.ARRAY(sa.String), nullable=False),
        sa.Column("is_active", sa.Boolean, server_default=sa.text("true")),
        sa.Column("description", sa.String(255), nullable=True),
        sa.Column("last_triggered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("consecutive_failures", sa.Integer, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("webhooks")
