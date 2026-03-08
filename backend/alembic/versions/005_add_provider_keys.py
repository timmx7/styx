"""005 – Add provider_keys table.

Revision ID: 005
Create Date: 2026-02-15
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "provider_keys",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("provider", sa.String(50), nullable=False),
        sa.Column("key_ciphertext", sa.Text, nullable=False),
        sa.Column("key_hint", sa.String(20), nullable=False),
        sa.Column("is_active", sa.Boolean, server_default=sa.text("true")),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column("rotated_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("project_id", "provider", name="uq_project_provider"),
    )


def downgrade() -> None:
    op.drop_table("provider_keys")
