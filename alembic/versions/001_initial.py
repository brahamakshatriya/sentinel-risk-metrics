"""Create initial tables

Revision ID: 001_initial
Revises: 
Create Date: 2024-01-01 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '001_initial'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'portfolios',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_portfolios_name', 'portfolios', ['name'], unique=False)

    op.create_table(
        'holdings',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('portfolio_id', sa.Integer(), nullable=False),
        sa.Column('symbol', sa.String(length=20), nullable=False),
        sa.Column('quantity', sa.Numeric(precision=18, scale=6), nullable=False),
        sa.Column('avg_cost', sa.Numeric(precision=18, scale=6), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['portfolio_id'], ['portfolios.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('portfolio_id', 'symbol', name='uq_portfolio_symbol')
    )
    op.create_index('ix_holdings_portfolio_id', 'holdings', ['portfolio_id'], unique=False)
    op.create_index('ix_holdings_symbol', 'holdings', ['symbol'], unique=False)

    op.create_table(
        'price_history',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('symbol', sa.String(length=20), nullable=False),
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('open', sa.Numeric(precision=12, scale=4), nullable=True),
        sa.Column('high', sa.Numeric(precision=12, scale=4), nullable=True),
        sa.Column('low', sa.Numeric(precision=12, scale=4), nullable=True),
        sa.Column('close', sa.Numeric(precision=12, scale=4), nullable=False),
        sa.Column('adjusted_close', sa.Numeric(precision=12, scale=4), nullable=True),
        sa.Column('volume', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('symbol', 'date', name='uq_symbol_date')
    )
    op.create_index('ix_price_history_symbol', 'price_history', ['symbol'], unique=False)
    op.create_index('ix_price_history_date', 'price_history', ['date'], unique=False)
    op.create_index('ix_symbol_date_desc', 'price_history', ['symbol', 'date'], unique=False, postgresql_using='btree')


def downgrade() -> None:
    op.drop_index('ix_symbol_date_desc', table_name='price_history')
    op.drop_index('ix_price_history_date', table_name='price_history')
    op.drop_index('ix_price_history_symbol', table_name='price_history')
    op.drop_table('price_history')
    op.drop_index('ix_holdings_symbol', table_name='holdings')
    op.drop_index('ix_holdings_portfolio_id', table_name='holdings')
    op.drop_table('holdings')
    op.drop_index('ix_portfolios_name', table_name='portfolios')
    op.drop_table('portfolios')