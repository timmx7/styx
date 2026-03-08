"""add ab_test_experiments model

Revision ID: 013_add_ab_test_experiments
Revises: 012_add_guardrails
Create Date: 2026-02-24 14:55:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '013_add_ab_test_experiments'
down_revision: Union[str, None] = '012_add_guardrails'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('ab_test_experiments',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('project_id', sa.UUID(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('variants', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ),
        sa.PrimaryKeyConstraint('id')
    )


def downgrade() -> None:
    op.drop_table('ab_test_experiments')
