"""add_ingestion_quotas_table

Revision ID: c41f9d2a7e55
Revises: be8acd5f3e64
Create Date: 2026-10-03

Phase S3 persistent business quota: one row per (user, UTC day).
Minimal additive migration: no existing table touched, no data rewrite.
Safe to re-run create_all in dev (model is in Base.metadata).

"""
from alembic import op
import sqlalchemy as sa


revision = 'c41f9d2a7e55'
down_revision = 'be8acd5f3e64'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'ingestion_quotas',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('day', sa.Date(), nullable=False),
        sa.Column('symbol_days', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'day', name='uq_quota_user_day')
    )
    op.create_index('ix_ingestion_quotas_id', 'ingestion_quotas', ['id'], unique=False)
    op.create_index('ix_ingestion_quotas_user_id', 'ingestion_quotas', ['user_id'], unique=False)
    op.create_index('ix_ingestion_quotas_day', 'ingestion_quotas', ['day'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_ingestion_quotas_day', table_name='ingestion_quotas')
    op.drop_index('ix_ingestion_quotas_user_id', table_name='ingestion_quotas')
    op.drop_index('ix_ingestion_quotas_id', table_name='ingestion_quotas')
    op.drop_table('ingestion_quotas')
