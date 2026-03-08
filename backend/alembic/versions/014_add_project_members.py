"""Add project_members table and missing project columns.

Revision ID: 014_add_project_members
Revises: 013_add_ab_test_experiments
Create Date: 2026-02-26
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "014_add_project_members"
down_revision: Union[str, None] = "013_add_ab_test_experiments"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── project_members table ──────────────────────────────────────
    op.create_table(
        "project_members",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("project_id", sa.Uuid(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("role", sa.String(20), nullable=False, server_default="developer"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("project_id", "user_id", name="uq_project_members_project_user"),
    )

    # ── missing project columns (safe: server_default for existing rows) ──
    op.add_column("projects", sa.Column("pii_redaction_enabled", sa.Boolean(), server_default="false", nullable=False))
    op.add_column("projects", sa.Column("semantic_cache_enabled", sa.Boolean(), server_default="true", nullable=False))
    op.add_column("projects", sa.Column("end_user_rate_limit", sa.Integer(), server_default="0", nullable=False))


def downgrade() -> None:
    op.drop_column("projects", "end_user_rate_limit")
    op.drop_column("projects", "semantic_cache_enabled")
    op.drop_column("projects", "pii_redaction_enabled")
    op.drop_table("project_members")
