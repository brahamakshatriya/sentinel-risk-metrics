from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from decimal import Decimal
from datetime import datetime, date

from app.db.database import get_db
from app.models import Portfolio, Holding, User, PortfolioShare, PermissionLevel
from app.schemas import (
    PortfolioCreate, PortfolioResponse, PortfolioWithHoldings,
    HoldingCreate, HoldingUpdate, HoldingResponse,
    MonteCarloRequest, MonteCarloResponse,
    ScenarioRequest, ScenarioResponse, RiskScoreResponse,
    PortfolioShareCreate, PortfolioShareResponse, PortfolioListResponse, UserResponse
)
from app.services.risk_calculator import get_risk_calculator
from app.auth import get_current_user
from app.authorization import (
    require_portfolio_view, require_portfolio_edit, require_portfolio_owner,
    get_portfolio_view, get_portfolio_edit, get_portfolio_owner,
    get_portfolio_access_level, AccessLevel
)

router = APIRouter(prefix="/portfolios", tags=["portfolios"])


@router.post("/", response_model=PortfolioResponse, status_code=status.HTTP_201_CREATED)
def create_portfolio(
    portfolio: PortfolioCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new portfolio owned by the authenticated user."""
    p = Portfolio(name=portfolio.name.strip(), owner_id=user.id)
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


@router.get("/{portfolio_id}", response_model=PortfolioWithHoldings)
def get_portfolio(
    portfolio: Portfolio = Depends(get_portfolio_view),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get portfolio with holdings - requires view access.
    Attaches the requesting user's ownership context (is_owner/permission/
    owner_email), which the frontend detail page requires to gate access.
    Without these fields the page treats every portfolio as inaccessible,
    including ones the user owns.
    """
    access_level = get_portfolio_access_level(user, portfolio, db)
    is_owner = access_level == AccessLevel.OWNER
    if access_level == AccessLevel.EDIT:
        permission = PermissionLevel.edit
    elif access_level == AccessLevel.VIEW:
        permission = PermissionLevel.view
    else:
        permission = None
    if is_owner:
        owner_email = user.email
    else:
        owner = db.query(User).filter(User.id == portfolio.owner_id).first() if portfolio.owner_id else None
        owner_email = owner.email if owner else None
    portfolio.is_owner = is_owner
    portfolio.permission = permission
    portfolio.owner_email = owner_email
    return portfolio


@router.get("/", response_model=List[PortfolioListResponse])
def list_portfolios(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    List portfolios the user owns or has been shared with.
    Returns portfolios with is_owner and permission fields.
    """
    # Get owned portfolios
    owned = db.query(Portfolio).filter(Portfolio.owner_id == user.id).all()
    
    # Get shared portfolios
    shares = db.query(PortfolioShare).filter(
        PortfolioShare.shared_with_user_id == user.id
    ).all()
    
    shared_portfolio_ids = [s.portfolio_id for s in shares]
    shared = db.query(Portfolio).filter(Portfolio.id.in_(shared_portfolio_ids)).all() if shared_portfolio_ids else []
    
    # Build response with ownership info
    result = []
    
    for p in owned:
        result.append(PortfolioListResponse(
            id=p.id,
            name=p.name,
            created_at=p.created_at,
            updated_at=p.updated_at,
            is_owner=True,
            permission=None,
            owner_email=user.email
        ))
    
    # Create a lookup for shares
    share_by_portfolio = {s.portfolio_id: s for s in shares}
    
    for p in shared:
        share = share_by_portfolio.get(p.id)
        owner = db.query(User).filter(User.id == p.owner_id).first() if p.owner_id else None
        result.append(PortfolioListResponse(
            id=p.id,
            name=p.name,
            created_at=p.created_at,
            updated_at=p.updated_at,
            is_owner=False,
            permission=share.permission if share else None,
            owner_email=owner.email if owner else None
        ))
    
    # Sort by created_at desc
    result.sort(key=lambda x: x.created_at, reverse=True)
    return result


@router.put("/{portfolio_id}", response_model=PortfolioResponse)
def update_portfolio(
    portfolio_id: int,
    portfolio_data: PortfolioCreate,
    portfolio: Portfolio = Depends(get_portfolio_owner),
    db: Session = Depends(get_db)
):
    """Update portfolio name - owner only."""
    portfolio.name = portfolio_data.name.strip()
    portfolio.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(portfolio)
    return portfolio


@router.delete("/{portfolio_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_portfolio(
    portfolio: Portfolio = Depends(get_portfolio_owner),
    db: Session = Depends(get_db)
):
    """Delete portfolio - owner only."""
    db.delete(portfolio)
    db.commit()


@router.post("/{portfolio_id}/holdings", response_model=HoldingResponse, status_code=status.HTTP_201_CREATED)
def add_holding(
    portfolio_id: int,
    holding: HoldingCreate,
    portfolio: Portfolio = Depends(get_portfolio_edit),
    db: Session = Depends(get_db)
):
    """Add holding to portfolio - requires edit access."""
    existing = db.query(Holding).filter(
        Holding.portfolio_id == portfolio_id,
        Holding.symbol == holding.symbol.upper()
    ).first()

    if existing:
        existing.quantity += holding.quantity
        if existing.avg_cost == 0:
            existing.avg_cost = holding.avg_cost
        else:
            total_cost = (existing.quantity - holding.quantity) * existing.avg_cost + holding.quantity * holding.avg_cost
            existing.avg_cost = total_cost / existing.quantity
        existing.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(existing)
        return existing

    h = Holding(
        portfolio_id=portfolio_id,
        symbol=holding.symbol.upper(),
        quantity=holding.quantity,
        avg_cost=holding.avg_cost
    )
    db.add(h)
    db.commit()
    db.refresh(h)
    return h


@router.get("/{portfolio_id}/holdings", response_model=List[HoldingResponse])
def get_holdings(
    portfolio: Portfolio = Depends(get_portfolio_view),
    db: Session = Depends(get_db)
):
    """Get holdings - requires view access."""
    return db.query(Holding).filter(Holding.portfolio_id == portfolio.id).all()


@router.put("/{portfolio_id}/holdings/{symbol}", response_model=HoldingResponse)
def update_holding(
    portfolio_id: int,
    symbol: str,
    holding: HoldingUpdate,
    portfolio: Portfolio = Depends(get_portfolio_edit),
    db: Session = Depends(get_db)
):
    """Update holding - requires edit access."""
    h = db.query(Holding).filter(
        Holding.portfolio_id == portfolio_id,
        Holding.symbol == symbol.upper()
    ).first()
    if not h:
        raise HTTPException(status_code=404, detail="Holding not found")

    if holding.quantity is not None:
        h.quantity = holding.quantity
    if holding.avg_cost is not None:
        h.avg_cost = holding.avg_cost
    h.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(h)
    return h


@router.delete("/{portfolio_id}/holdings/{symbol}", status_code=status.HTTP_204_NO_CONTENT)
def delete_holding(
    portfolio_id: int,
    symbol: str,
    portfolio: Portfolio = Depends(get_portfolio_edit),
    db: Session = Depends(get_db)
):
    """Delete holding - requires edit access."""
    h = db.query(Holding).filter(
        Holding.portfolio_id == portfolio_id,
        Holding.symbol == symbol.upper()
    ).first()
    if not h:
        raise HTTPException(status_code=404, detail="Holding not found")
    db.delete(h)
    db.commit()


@router.post("/{portfolio_id}/monte-carlo", response_model=MonteCarloResponse)
def run_monte_carlo(
    portfolio_id: int,
    request: MonteCarloRequest,
    portfolio: Portfolio = Depends(get_portfolio_view),
    db: Session = Depends(get_db)
):
    """Run Monte Carlo simulation - requires view access."""
    # Override portfolio_id from path
    request.portfolio_id = portfolio_id
    
    calculator = get_risk_calculator(db)
    result = calculator.run_monte_carlo(
        portfolio_id=request.portfolio_id,
        lookback_days=request.lookback_days,
        num_simulations=request.num_simulations,
        horizon_days=request.horizon_days,
        confidence_level=request.confidence_level
    )
    
    if not result:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    
    return MonteCarloResponse(
        portfolio_id=result["portfolio_id"],
        portfolio_name=result["portfolio_name"],
        as_of_date=result["as_of_date"],
        lookback_days=result["lookback_days"],
        num_simulations=result["num_simulations"],
        horizon_days=result["horizon_days"],
        confidence_level=result["confidence_level"],
        current_value=Decimal(str(result["current_value"])),
        var=Decimal(str(result["var"])),
        cvar=Decimal(str(result["cvar"])),
        var_pct=Decimal(str(result["var_pct"])),
        cvar_pct=Decimal(str(result["cvar_pct"])),
        mean_final_value=Decimal(str(result["mean_final_value"])),
        median_final_value=Decimal(str(result["median_final_value"])),
        percentiles={k: Decimal(str(v)) for k, v in result["percentiles"].items()},
        return_percentiles={k: Decimal(str(v)) for k, v in result["return_percentiles"].items()},
        prob_loss=Decimal(str(result["prob_loss"])),
        prob_gain=Decimal(str(result["prob_gain"])),
        simulated_paths_sample=result["simulated_paths_sample"]
    )


@router.post("/{portfolio_id}/scenario", response_model=ScenarioResponse)
def run_scenario(
    portfolio_id: int,
    request: ScenarioRequest,
    portfolio: Portfolio = Depends(get_portfolio_view),
    db: Session = Depends(get_db)
):
    """Run scenario analysis - requires view access."""
    # Override portfolio_id from path
    request.portfolio_id = portfolio_id
    
    calculator = get_risk_calculator(db)
    result = calculator.run_scenario_analysis(
        portfolio_id=request.portfolio_id,
        market_drop_pct=request.market_drop_pct,
        vol_spike_pct=request.vol_spike_pct,
        lookback_days=request.lookback_days,
        confidence_level=request.confidence_level
    )
    
    if not result:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    
    return ScenarioResponse(
        portfolio_id=result["portfolio_id"],
        portfolio_name=result["portfolio_name"],
        as_of_date=result["as_of_date"],
        market_drop_pct=result["market_drop_pct"],
        vol_spike_pct=result["vol_spike_pct"],
        current_value=Decimal(str(result["current_value"])),
        shocked_value=Decimal(str(result["shocked_value"])),
        value_change=Decimal(str(result["value_change"])),
        value_change_pct=Decimal(str(result["value_change_pct"])),
        original_var_95=Decimal(str(result["original_var_95"])),
        shocked_var_95=Decimal(str(result["shocked_var_95"])),
        var_change_pct=Decimal(str(result["var_change_pct"])),
        original_volatility=Decimal(str(result["original_volatility"])),
        shocked_volatility=Decimal(str(result["shocked_volatility"])),
    )


@router.get("/{portfolio_id}/risk-score", response_model=RiskScoreResponse)
def get_risk_score(
    portfolio_id: int,
    lookback_days: int = Query(default=252, ge=30, le=2520),
    confidence_level: float = Query(default=0.95, gt=0, lt=1),
    portfolio: Portfolio = Depends(get_portfolio_view),
    db: Session = Depends(get_db)
):
    """Get composite risk score - requires view access."""
    calculator = get_risk_calculator(db)
    result = calculator.calculate_risk_score(
        portfolio_id=portfolio_id,
        lookback_days=lookback_days,
        confidence_level=confidence_level
    )
    
    if not result:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    
    return RiskScoreResponse(
        portfolio_id=result["portfolio_id"],
        portfolio_name=portfolio.name,
        as_of_date=date.today(),
        risk_score=result["risk_score"],
        risk_label=result["risk_label"],
        var_component=result["var_component"],
        sharpe_component=result["sharpe_component"],
        correlation_component=result["correlation_component"],
    )


# === Share Management Endpoints ===

@router.post("/{portfolio_id}/share", response_model=PortfolioShareResponse, status_code=status.HTTP_201_CREATED)
def share_portfolio(
    portfolio_id: int,
    share_data: PortfolioShareCreate,
    portfolio: Portfolio = Depends(get_portfolio_owner),
    db: Session = Depends(get_db)
):
    """
    Share a portfolio with another user - owner only.
    
    The target user must already have a Sentinel account (must have signed up at least once).
    Returns a clear error if the user doesn't exist.
    """
    # Find the target user by email
    target_user = db.query(User).filter(User.email == share_data.email.lower()).first()
    if not target_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User with email '{share_data.email}' not found. They must sign up for Sentinel first before you can share with them."
        )
    
    # Can't share with yourself
    if target_user.id == portfolio.owner_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot share portfolio with yourself (you are the owner)"
        )
    
    # Check if share already exists
    existing_share = db.query(PortfolioShare).filter(
        PortfolioShare.portfolio_id == portfolio_id,
        PortfolioShare.shared_with_user_id == target_user.id
    ).first()
    
    if existing_share:
        # Update existing share permission
        existing_share.permission = share_data.permission
        existing_share.created_by_user_id = portfolio.owner_id
        db.commit()
        db.refresh(existing_share)
        share = existing_share
    else:
        # Create new share
        share = PortfolioShare(
            portfolio_id=portfolio_id,
            shared_with_user_id=target_user.id,
            permission=share_data.permission,
            created_by_user_id=portfolio.owner_id
        )
        db.add(share)
        db.commit()
        db.refresh(share)
    
    return PortfolioShareResponse(
        id=share.id,
        portfolio_id=share.portfolio_id,
        shared_with_user_id=share.shared_with_user_id,
        shared_with_email=target_user.email,
        permission=share.permission,
        created_at=share.created_at,
        created_by_user_id=share.created_by_user_id
    )


@router.get("/{portfolio_id}/shares", response_model=List[PortfolioShareResponse])
def list_shares(
    portfolio: Portfolio = Depends(get_portfolio_owner),
    db: Session = Depends(get_db)
):
    """List all shares for a portfolio - owner only."""
    shares = db.query(PortfolioShare).filter(
        PortfolioShare.portfolio_id == portfolio.id
    ).all()
    
    result = []
    for share in shares:
        shared_user = db.query(User).filter(User.id == share.shared_with_user_id).first()
        result.append(PortfolioShareResponse(
            id=share.id,
            portfolio_id=share.portfolio_id,
            shared_with_user_id=share.shared_with_user_id,
            shared_with_email=shared_user.email if shared_user else "unknown",
            permission=share.permission,
            created_at=share.created_at,
            created_by_user_id=share.created_by_user_id
        ))
    
    return result


@router.delete("/{portfolio_id}/shares/{share_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_share(
    portfolio_id: int,
    share_id: int,
    portfolio: Portfolio = Depends(get_portfolio_owner),
    db: Session = Depends(get_db)
):
    """Revoke a share - owner only."""
    share = db.query(PortfolioShare).filter(
        PortfolioShare.id == share_id,
        PortfolioShare.portfolio_id == portfolio_id
    ).first()
    
    if not share:
        raise HTTPException(status_code=404, detail="Share not found")
    
    db.delete(share)
    db.commit()