"""
Authorization module for Sentinel.

Centralized permission checking for portfolio access.
All portfolio-related endpoints should use these dependencies to ensure
consistent authorization logic.
"""
from enum import Enum
from typing import Optional
from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.auth import get_current_user
from app.models import User, Portfolio, PortfolioShare, PermissionLevel


class AccessLevel(str, Enum):
    """Access levels a user can have on a portfolio."""
    NONE = "none"
    VIEW = "view"
    EDIT = "edit"
    OWNER = "owner"


def get_portfolio_access_level(
    user: User,
    portfolio: Portfolio,
    db: Session
) -> AccessLevel:
    """
    Determine the access level a user has on a portfolio.
    
    Returns:
        AccessLevel: OWNER if user owns the portfolio,
                    EDIT if user has edit share,
                    VIEW if user has view share,
                    NONE otherwise.
    """
    # Check if owner
    if portfolio.owner_id == user.id:
        return AccessLevel.OWNER
    
    # Check for explicit share
    share = db.query(PortfolioShare).filter(
        PortfolioShare.portfolio_id == portfolio.id,
        PortfolioShare.shared_with_user_id == user.id
    ).first()
    
    if share:
        if share.permission == PermissionLevel.edit:
            return AccessLevel.EDIT
        elif share.permission == PermissionLevel.view:
            return AccessLevel.VIEW
    
    return AccessLevel.NONE


def require_portfolio_access(
    required_level: AccessLevel,
    portfolio_id_param: str = "portfolio_id"
):
    """
    FastAPI dependency factory that creates a dependency requiring
    a minimum access level on a portfolio.
    
    Usage:
        @router.get("/{portfolio_id}")
        def get_portfolio(
            portfolio_id: int,
            access: AccessLevel = Depends(require_portfolio_access(AccessLevel.VIEW))
        ):
            ...
    
    Args:
        required_level: Minimum access level required (VIEW, EDIT, or OWNER)
        portfolio_id_param: Name of the path parameter containing portfolio_id
    
    Returns:
        A dependency that returns the AccessLevel if authorized,
        raises HTTPException (403/404) otherwise.
    """
    async def _check_access(
        portfolio_id: int,
        user: User = Depends(get_current_user),
        db: Session = Depends(get_db)
    ) -> AccessLevel:
        # Fetch portfolio
        portfolio = db.query(Portfolio).filter(Portfolio.id == portfolio_id).first()
        if not portfolio:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Portfolio not found"
            )
        
        # Check access level
        access_level = get_portfolio_access_level(user, portfolio, db)
        
        # Verify meets requirement
        if required_level == AccessLevel.OWNER and access_level != AccessLevel.OWNER:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the portfolio owner can perform this action"
            )
        elif required_level == AccessLevel.EDIT and access_level not in (AccessLevel.EDIT, AccessLevel.OWNER):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Edit access required for this portfolio"
            )
        elif required_level == AccessLevel.VIEW and access_level == AccessLevel.NONE:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have access to this portfolio"
            )
        
        return access_level
    
    return _check_access


# Convenience dependencies for common access levels
require_portfolio_view = require_portfolio_access(AccessLevel.VIEW)
require_portfolio_edit = require_portfolio_access(AccessLevel.EDIT)
require_portfolio_owner = require_portfolio_access(AccessLevel.OWNER)


def get_portfolio_with_access(
    required_level: AccessLevel = AccessLevel.VIEW,
    portfolio_id_param: str = "portfolio_id"
):
    """
    FastAPI dependency factory that returns the Portfolio object
    after verifying the user has the required access level.
    
    Usage:
        @router.get("/{portfolio_id}")
        def get_portfolio(
            portfolio: Portfolio = Depends(get_portfolio_with_access(AccessLevel.VIEW))
        ):
            ...
    
    Returns:
        A dependency that returns the Portfolio if authorized,
        raises HTTPException (403/404) otherwise.
    """
    async def _get_portfolio(
        portfolio_id: int,
        user: User = Depends(get_current_user),
        db: Session = Depends(get_db)
    ) -> Portfolio:
        portfolio = db.query(Portfolio).filter(Portfolio.id == portfolio_id).first()
        if not portfolio:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Portfolio not found"
            )
        
        access_level = get_portfolio_access_level(user, portfolio, db)
        
        if required_level == AccessLevel.OWNER and access_level != AccessLevel.OWNER:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the portfolio owner can perform this action"
            )
        elif required_level == AccessLevel.EDIT and access_level not in (AccessLevel.EDIT, AccessLevel.OWNER):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Edit access required for this portfolio"
            )
        elif required_level == AccessLevel.VIEW and access_level == AccessLevel.NONE:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have access to this portfolio"
            )
        
        return portfolio
    
    return _get_portfolio


# Convenience dependencies that return Portfolio object
get_portfolio_view = get_portfolio_with_access(AccessLevel.VIEW)
get_portfolio_edit = get_portfolio_with_access(AccessLevel.EDIT)
get_portfolio_owner = get_portfolio_with_access(AccessLevel.OWNER)


def can_user_delete_portfolio(user: User, portfolio: Portfolio, db: Session) -> bool:
    """Check if user can delete a portfolio (owner only)."""
    return portfolio.owner_id == user.id


def can_user_manage_shares(user: User, portfolio: Portfolio, db: Session) -> bool:
    """Check if user can manage shares (owner only)."""
    return portfolio.owner_id == user.id


def can_user_modify_holdings(user: User, portfolio: Portfolio, db: Session) -> bool:
    """Check if user can add/update/delete holdings (owner or edit share)."""
    access = get_portfolio_access_level(user, portfolio, db)
    return access in (AccessLevel.OWNER, AccessLevel.EDIT)


def can_user_run_analysis(user: User, portfolio: Portfolio, db: Session) -> bool:
    """Check if user can run analyses (owner, edit, or view share)."""
    access = get_portfolio_access_level(user, portfolio, db)
    return access != AccessLevel.NONE