"""add_users_and_portfolio_shares

Revision ID: be8acd5f3e64
Revises: 84648eccb3f7
Create Date: 2026-08-18 22:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'be8acd5f3e64'
down_revision = '84648eccb3f7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create users table
    op.create_table(
        'users',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('clerk_user_id', sa.String(length=255), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_users_clerk_user_id', 'users', ['clerk_user_id'], unique=True)
    op.create_index('ix_users_email', 'users', ['email'], unique=False)
    op.create_index('ix_users_id', 'users', ['id'], unique=False)

    # Add owner_id to portfolios (nullable for existing portfolios)
    op.add_column('portfolios', sa.Column('owner_id', sa.Integer(), nullable=True))
    op.create_index('ix_portfolios_owner_id', 'portfolios', ['owner_id'], unique=False)
    op.create_foreign_key('fk_portfolios_owner_id', 'portfolios', 'users', ['owner_id'], ['id'], ondelete='CASCADE')

    # Create portfolio_shares table
    op.create_table(
        'portfolio_shares',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('portfolio_id', sa.Integer(), nullable=False),
        sa.Column('shared_with_user_id', sa.Integer(), nullable=False),
        sa.Column('permission', sa.Enum('view', 'edit', name='permission_level'), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('created_by_user_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['portfolio_id'], ['portfolios.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['shared_with_user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('portfolio_id', 'shared_with_user_id', name='uq_portfolio_shared_user')
    )
    op.create_index('ix_portfolio_shares_id', 'portfolio_shares', ['id'], unique=False)
    op.create_index('ix_portfolio_shares_portfolio_id', 'portfolio_shares', ['portfolio_id'], unique=False)
    op.create_index('ix_portfolio_shares_shared_with_user_id', 'portfolio_shares', ['shared_with_user_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_portfolio_shares_shared_with_user_id', table_name='portfolio_shares')
    op.drop_index('ix_portfolio_shares_portfolio_id', table_name='portfolio_shares')
    op.drop_index('ix_portfolio_shares_id', table_name='portfolio_shares')
    op.drop_table('portfolio_shares')
    op.drop_constraint('fk_portfolios_owner_id', 'portfolios', type_='foreignkey')
    op.drop_index('ix_portfolios_owner_id', table_name='portfolios')
    op.drop_column('portfolios', 'owner_id')
    op.drop_index('ix_users_id', table_name='users')
    op.drop_index('ix_users_email', table_name='users')
    op.drop_index('ix_users_clerk_user_id', table_name='users')
    op.drop_table('users')
    # Drop the enum type
    op.execute("DROP TYPE IF EXISTS permission_level")