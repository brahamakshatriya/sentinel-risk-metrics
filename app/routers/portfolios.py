from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from decimal import Decimal
from datetime import datetime

from app.db.database import get_db
from app.models import Portfolio, Holding
from app.schemas import (
    PortfolioCreate, PortfolioResponse, PortfolioWithHoldings,
    HoldingCreate, HoldingUpdate, HoldingResponse,
    MonteCarloRequest, MonteCarloResponse
)
from app.services.risk_calculator import get_risk_calculator

router = APIRouter(prefix="/portfolios", tags=["portfolios"])


@router.post("/", response_model=PortfolioResponse, status_code=status.HTTP_201_CREATED)
def create_portfolio(portfolio: PortfolioCreate, db: Session = Depends(get_db)):
    p = Portfolio(name=portfolio.name.strip())
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


@router.get("/{portfolio_id}", response_model=PortfolioWithHoldings)
def get_portfolio(portfolio_id: int, db: Session = Depends(get_db)):
    portfolio = db.query(Portfolio).filter(Portfolio.id == portfolio_id).first()
    if not portfolio:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return portfolio


@router.get("/", response_model=List[PortfolioResponse])
def list_portfolios(db: Session = Depends(get_db)):
    return db.query(Portfolio).order_by(Portfolio.created_at.desc()).all()


@router.put("/{portfolio_id}", response_model=PortfolioResponse)
def update_portfolio(portfolio_id: int, portfolio: PortfolioCreate, db: Session = Depends(get_db)):
    p = db.query(Portfolio).filter(Portfolio.id == portfolio_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    p.name = portfolio.name.strip()
    p.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(p)
    return p


@router.delete("/{portfolio_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_portfolio(portfolio_id: int, db: Session = Depends(get_db)):
    p = db.query(Portfolio).filter(Portfolio.id == portfolio_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    db.delete(p)
    db.commit()


@router.post("/{portfolio_id}/holdings", response_model=HoldingResponse, status_code=status.HTTP_201_CREATED)
def add_holding(portfolio_id: int, holding: HoldingCreate, db: Session = Depends(get_db)):
    portfolio = db.query(Portfolio).filter(Portfolio.id == portfolio_id).first()
    if not portfolio:
        raise HTTPException(status_code=404, detail="Portfolio not found")

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
def get_holdings(portfolio_id: int, db: Session = Depends(get_db)):
    portfolio = db.query(Portfolio).filter(Portfolio.id == portfolio_id).first()
    if not portfolio:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return db.query(Holding).filter(Holding.portfolio_id == portfolio_id).all()


@router.put("/{portfolio_id}/holdings/{symbol}", response_model=HoldingResponse)
def update_holding(
    portfolio_id: int,
    symbol: str,
    holding: HoldingUpdate,
    db: Session = Depends(get_db)
):
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
def delete_holding(portfolio_id: int, symbol: str, db: Session = Depends(get_db)):
    h = db.query(Holding).filter(
        Holding.portfolio_id == portfolio_id,
        Holding.symbol == symbol.upper()
    ).first()
    if not h:
        raise HTTPException(status_code=404, detail="Holding not found")
    db.delete(h)
    db.commit()


@router.post("/{portfolio_id}/monte-carlo", response_model=MonteCarloResponse)
def run_monte_carlo(portfolio_id: int, request: MonteCarloRequest, db: Session = Depends(get_db)):
    """Run Monte Carlo simulation for portfolio forward-looking risk analysis."""
    # Validate portfolio exists
    portfolio = db.query(Portfolio).filter(Portfolio.id == portfolio_id).first()
    if not portfolio:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    
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