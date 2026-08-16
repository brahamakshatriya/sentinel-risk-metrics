"""Add risk_free_rate_cache table

Revision ID: 84648eccb3f7
Revises: 001_initial
Create Date: 2024-01-15 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from datetime import datetime


# revision identifiers, used by Alembic.
revision = '84648eccb3f7'
down_revision = '001_initial'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'risk_free_rate_cache',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('series_id', sa.String(length=50), nullable=False),
        sa.Column('rate', sa.Numeric(precision=10, scale=6), nullable=False),
        sa.Column('fetched_at', sa.DateTime(), default=datetime.utcnow, nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('series_id', 'fetched_at', name='uq_series_fetched')
    )
    op.create_index('ix_risk_free_rate_cache_id', 'risk_free_rate_cache', ['id'], unique=False)
    op.create_index('ix_risk_free_rate_cache_series_id', 'risk_free_rate_cache', ['series_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_risk_free_rate_cache_series_id', table_name='risk_free_rate_cache')
    op.drop_index('ix_risk_free_rate_cache_id', table_name='risk_free_rate_cache')
    op.drop_table('risk_free_rate_cache')