"""010 – Add billing tables (subscriptions, credit_balances,
credit_transactions, model_pricing) and user.billing_mode column.

Creates the four tables required for the dual Charon / Achilles billing
system and seeds model_pricing with the initial 11 AI models.

Revision ID: 010
Create Date: 2026-02-19
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "010"
down_revision = "009"
branch_labels = None
depends_on = None

PG_UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    # ── 1. users.billing_mode ─────────────────────────────────────
    op.add_column(
        "users",
        sa.Column("billing_mode", sa.String(10), nullable=True),
    )

    # ── 2. subscriptions ──────────────────────────────────────────
    op.create_table(
        "subscriptions",
        sa.Column("id", PG_UUID, primary_key=True),
        sa.Column(
            "user_id",
            PG_UUID,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("billing_mode", sa.String(10), nullable=False),
        sa.Column("plan", sa.String(20), nullable=False),
        sa.Column("stripe_customer_id", sa.String(255), nullable=True),
        sa.Column("stripe_subscription_id", sa.String(255), nullable=True),
        sa.Column("status", sa.String(20), server_default="active"),
        sa.Column("current_period_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("requests_used", sa.Integer, server_default="0"),
        sa.Column("requests_limit", sa.Integer, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
        ),
    )

    # ── 3. credit_balances ────────────────────────────────────────
    op.create_table(
        "credit_balances",
        sa.Column("id", PG_UUID, primary_key=True),
        sa.Column(
            "user_id",
            PG_UUID,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
            index=True,
        ),
        sa.Column("balance_cents", sa.Integer, server_default="0"),
        sa.Column("total_purchased_cents", sa.Integer, server_default="0"),
        sa.Column("total_consumed_cents", sa.Integer, server_default="0"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
        ),
    )

    # ── 4. credit_transactions ────────────────────────────────────
    op.create_table(
        "credit_transactions",
        sa.Column("id", PG_UUID, primary_key=True),
        sa.Column(
            "user_id",
            PG_UUID,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("type", sa.String(20), nullable=False),
        sa.Column("amount_cents", sa.Integer, nullable=False),
        sa.Column("balance_after_cents", sa.Integer, nullable=False),
        sa.Column("description", sa.String(500), nullable=True),
        sa.Column("request_id", PG_UUID, nullable=True),
        sa.Column("stripe_payment_id", sa.String(255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            index=True,
        ),
    )

    # ── 5. model_pricing ──────────────────────────────────────────
    op.create_table(
        "model_pricing",
        sa.Column("id", PG_UUID, primary_key=True),
        sa.Column("provider", sa.String(50), nullable=False),
        sa.Column("model", sa.String(100), nullable=False),
        sa.Column("display_name", sa.String(100), nullable=False),
        sa.Column("input_price_per_million", sa.Numeric(10, 4), nullable=False),
        sa.Column("output_price_per_million", sa.Numeric(10, 4), nullable=False),
        sa.Column("cost_input_per_million", sa.Numeric(10, 4), nullable=False),
        sa.Column("cost_output_per_million", sa.Numeric(10, 4), nullable=False),
        sa.Column("is_active", sa.Boolean, server_default=sa.text("true")),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("provider", "model", name="uq_model_pricing_provider_model"),
    )

    # ── 6. Seed model_pricing with 11 AI models ──────────────────
    #       Client price = provider cost × 1.50  (50% Achilles markup)
    models = [
        ("openai",    "gpt-4o-mini",          "GPT-4o Mini",          0.15, 0.60),
        ("openai",    "gpt-4o",               "GPT-4o",               2.50, 10.00),
        ("openai",    "gpt-4.1",              "GPT-4.1",              2.00, 8.00),
        ("anthropic", "claude-haiku-4.5",      "Claude Haiku 4.5",    1.00, 5.00),
        ("anthropic", "claude-sonnet-4.5",     "Claude Sonnet 4.5",   3.00, 15.00),
        ("anthropic", "claude-opus-4.5",       "Claude Opus 4.5",     5.00, 25.00),
        ("google",    "gemini-2.5-flash",      "Gemini 2.5 Flash",    0.15, 0.60),
        ("google",    "gemini-2.5-pro",        "Gemini 2.5 Pro",      1.25, 10.00),
        ("mistral",   "mistral-small-3.1",     "Mistral Small 3.1",   0.03, 0.11),
        ("mistral",   "mistral-medium-3",      "Mistral Medium 3",    0.40, 2.00),
        ("mistral",   "mistral-large-3",       "Mistral Large 3",     0.50, 1.50),
    ]

    # Use raw SQL for the seed to avoid UUID type mismatch with bulk_insert
    for provider, model, display, cost_in, cost_out in models:
        op.execute(
            sa.text(
                "INSERT INTO model_pricing "
                "(id, provider, model, display_name, "
                "input_price_per_million, output_price_per_million, "
                "cost_input_per_million, cost_output_per_million) "
                "VALUES (gen_random_uuid(), :provider, :model, :display, "
                ":inp, :outp, :ci, :co)"
            ).bindparams(
                provider=provider,
                model=model,
                display=display,
                inp=round(cost_in * 1.50, 4),
                outp=round(cost_out * 1.50, 4),
                ci=cost_in,
                co=cost_out,
            )
        )


def downgrade() -> None:
    op.drop_table("model_pricing")
    op.drop_table("credit_transactions")
    op.drop_table("credit_balances")
    op.drop_table("subscriptions")
    op.drop_column("users", "billing_mode")
