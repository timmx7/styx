"""001 – Initial schema: all tables.

Revision ID: 001
Create Date: 2026-02-12
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# Revision identifiers
revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── users ─────────────────────────────────────────────────────
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(255), unique=True, nullable=False, index=True),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("name", sa.String(255), nullable=True),
        sa.Column("role", sa.String(50), server_default="user", nullable=False),
        sa.Column("stripe_customer_id", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── teams ─────────────────────────────────────────────────────
    op.create_table(
        "teams",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("plan", sa.String(50), server_default="starter", nullable=False),
        sa.Column("stripe_subscription_id", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── projects ──────────────────────────────────────────────────
    op.create_table(
        "projects",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("team_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("teams.id"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("budget_monthly_cents", sa.Integer, nullable=True),
        sa.Column("budget_alert_threshold_pct", sa.Integer, server_default="80"),
        sa.Column("allowed_providers", postgresql.ARRAY(sa.String), nullable=True),
        sa.Column("routing_strategy", sa.String(50), server_default="cost_optimized"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── api_keys ──────────────────────────────────────────────────
    op.create_table(
        "api_keys",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("key_hash", sa.String(255), nullable=False, index=True),
        sa.Column("key_prefix", sa.String(20), nullable=False),
        sa.Column("name", sa.String(255), nullable=True),
        sa.Column("permissions", postgresql.JSONB, server_default="{}"),
        sa.Column("rate_limit_per_minute", sa.Integer, server_default="60"),
        sa.Column("is_active", sa.Boolean, server_default="true"),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── usage_logs ────────────────────────────────────────────────
    op.create_table(
        "usage_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("api_key_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("api_keys.id"), nullable=False),
        sa.Column("provider", sa.String(50), nullable=False),
        sa.Column("model", sa.String(100), nullable=False),
        sa.Column("input_tokens", sa.Integer, nullable=True),
        sa.Column("output_tokens", sa.Integer, nullable=True),
        sa.Column("cost_cents", sa.Integer, nullable=True),
        sa.Column("latency_ms", sa.Integer, nullable=True),
        sa.Column("cache_hit", sa.Boolean, server_default="false"),
        sa.Column("was_fallback", sa.Boolean, server_default="false"),
        sa.Column("complexity", sa.String(20), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── routing_logs ──────────────────────────────────────────────
    op.create_table(
        "routing_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", sa.String(255), nullable=False, index=True),
        sa.Column("provider", sa.String(50), nullable=False),
        sa.Column("model", sa.String(100), nullable=False),
        sa.Column("complexity", sa.String(20), nullable=False),
        sa.Column("latency_ms", sa.Integer, nullable=False),
        sa.Column("status_code", sa.Integer, nullable=False),
        sa.Column("cache_hit", sa.Boolean, server_default="false"),
        sa.Column("was_fallback", sa.Boolean, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), index=True),
    )

    # ── alerts ────────────────────────────────────────────────────
    op.create_table(
        "alerts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", sa.String(255), nullable=False, index=True),
        sa.Column("team_id", sa.String(255), nullable=False, index=True),
        sa.Column("alert_type", sa.String(50), nullable=False),
        sa.Column("severity", sa.String(20), nullable=False, server_default="warning"),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("message", sa.Text, nullable=False),
        sa.Column("metadata_json", sa.Text, nullable=True),
        sa.Column("is_read", sa.Boolean, server_default="false"),
        sa.Column("budget_cents", sa.Integer, nullable=True),
        sa.Column("spent_cents", sa.Integer, nullable=True),
        sa.Column("threshold_pct", sa.Integer, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), index=True),
    )


def downgrade() -> None:
    op.drop_table("alerts")
    op.drop_table("routing_logs")
    op.drop_table("usage_logs")
    op.drop_table("api_keys")
    op.drop_table("projects")
    op.drop_table("teams")
    op.drop_table("users")
