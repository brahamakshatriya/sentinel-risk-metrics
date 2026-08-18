from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from datetime import date, datetime, timedelta
from decimal import Decimal
import logging

from app.db.database import get_db
from app.models import PriceHistory, Portfolio, Holding
from app.schemas import (
    PriceIngestRequest, PriceIngestResponse,
    PriceHistoryResponse,
    PortfolioValueResponse, RiskMetricsRequest, RiskMetricsResponse,
    PortfolioValueRequest
)
from app.services.risk_calculator import get_risk_calculator
from app.services.yfinance_service import yfinance_service
from app.auth import get_current_user
from app.authorization import get_portfolio_view, get_portfolio_edit, AccessLevel

router = APIRouter(prefix="/ingest", tags=["ingestion"])
logger = logging.getLogger(__name__)


@router.post("/batch", response_model=List[PriceIngestResponse])
def ingest_batch_prices(
    request: PriceIngestRequest,
    db: Session = Depends(get_db)
):
    """
    Batch ingest price data - public endpoint (no auth required).
    Price data is global and not tied to user portfolios.
    """
    logger.info(f"Batch ingest requested for symbols: {request.symbols}, date range: {request.start_date} to {request.end_date}")
    
    results = yfinance_service.fetch_multiple_symbols(
        request.symbols, request.start_date, request.end_date
    )
    
    if not results:
        logger.warning(f"No data returned from yfinance for any symbols: {request.symbols}")
        return [
            PriceIngestResponse(
                symbol=s,
                records_ingested=0,
                date_range=f"{request.start_date} to {request.end_date}",
                skipped=False,
                error="No data returned from provider (rate limit, invalid ticker, or network error)"
            )
            for s in request.symbols
        ]

    responses = []
    for symbol in request.symbols:
        symbol = symbol.upper()
        records = results.get(symbol, [])
        
        if not records:
            logger.warning(f"No data returned for {symbol} in batch ingest")
            responses.append(PriceIngestResponse(
                symbol=symbol,
                records_ingested=0,
                date_range=f"{request.start_date} to {request.end_date}",
                skipped=False,
                error="No data returned from provider (rate limit, invalid ticker, or network error)"
            ))
            continue

        existing_count = db.query(func.count(PriceHistory.id)).filter(
            PriceHistory.symbol == symbol,
            PriceHistory.date >= request.start_date,
            PriceHistory.date <= request.end_date
        ).scalar()
        
        if existing_count > 0:
            logger.info(f"Skipping {symbol}: {existing_count} records already exist for date range")
            responses.append(PriceIngestResponse(
                symbol=symbol,
                records_ingested=0,
                date_range=f"{request.start_date} to {request.end_date}",
                skipped=True,
                error=None
            ))
            continue
        
        ingested = 0
        for record in records:
            stmt = db.query(PriceHistory).filter(
                PriceHistory.symbol == record["symbol"],
                PriceHistory.date == record["date"]
            ).first()
            if not stmt:
                ph = PriceHistory(**record)
                db.add(ph)
                ingested += 1
        
        try:
            db.commit()
            logger.info(f"Successfully ingested {ingested} records for {symbol}")
        except Exception as e:
            db.rollback()
            logger.error(f"Database error ingesting {symbol}: {e}", exc_info=True)
            responses.append(PriceIngestResponse(
                symbol=symbol,
                records_ingested=0,
                date_range=f"{request.start_date} to {request.end_date}",
                skipped=False,
                error=f"Database error: {str(e)}"
            ))
            continue
        
        responses.append(PriceIngestResponse(
            symbol=symbol,
            records_ingested=ingested,
            date_range=f"{request.start_date} to {request.end_date}",
            skipped=False,
            error=None
        ))

    return responses


@router.get("/price-history/{symbol}", response_model=List[PriceHistoryResponse])
def get_price_history(
    symbol: str,
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    limit: int = Query(1000, ge=1, le=5000),
    db: Session = Depends(get_db)
):
    """Get price history - public endpoint (no auth required)."""
    symbol = symbol.upper()
    end = end_date or date.today()
    start = start_date or date(end.year - 1, end.month, end.day)

    logger.debug(f"Fetching price history for {symbol} from {start} to {end}, limit={limit}")

    records = db.query(PriceHistory).filter(
        PriceHistory.symbol == symbol,
        PriceHistory.date >= start,
        PriceHistory.date <= end
    ).order_by(PriceHistory.date.asc()).limit(limit).all()

    return records


@router.get("/price-history/{symbol}/latest", response_model=PriceHistoryResponse)
def get_latest_price(symbol: str, as_of: Optional[date] = Query(None), db: Session = Depends(get_db)):
    """Get latest price - public endpoint (no auth required)."""
    symbol = symbol.upper()
    query = db.query(PriceHistory).filter(PriceHistory.symbol == symbol)
    if as_of:
        query = query.filter(PriceHistory.date <= as_of)
    record = query.order_by(PriceHistory.date.desc()).first()
    
    if not record:
        raise HTTPException(status_code=404, detail=f"No price data found for {symbol}")
    return record


@router.post("/portfolio-value", response_model=PortfolioValueResponse)
def get_portfolio_value(
    request: PortfolioValueRequest,
    portfolio: Portfolio = Depends(get_portfolio_view),
    db: Session = Depends(get_db)
):
    """Get portfolio value - requires view access."""
    as_of = request.as_of_date or date.today()
    holdings = db.query(Holding).filter(Holding.portfolio_id == portfolio.id).all()

    total_value = Decimal("0")
    total_cost = Decimal("0")
    holdings_detail = []
    missing_price_symbols = []

    for holding in holdings:
        price_record = db.query(PriceHistory.close).filter(
            PriceHistory.symbol == holding.symbol,
            PriceHistory.date <= as_of
        ).order_by(PriceHistory.date.desc()).first()
        
        if price_record:
            current_price = price_record[0]
            market_value = holding.quantity * current_price
            cost_basis = holding.quantity * holding.avg_cost
            pnl = market_value - cost_basis
            pnl_pct = (pnl / cost_basis * 100) if cost_basis > 0 else Decimal("0")

            total_value += market_value
            total_cost += cost_basis

            holdings_detail.append({
                "symbol": holding.symbol,
                "quantity": float(holding.quantity),
                "avg_cost": float(holding.avg_cost),
                "current_price": float(current_price),
                "market_value": float(market_value),
                "cost_basis": float(cost_basis),
                "pnl": float(pnl),
                "pnl_pct": float(pnl_pct)
            })
        else:
            missing_price_symbols.append(holding.symbol)
            logger.warning(f"No price data for {holding.symbol} as of {as_of}")

    total_pnl = total_value - total_cost
    total_pnl_pct = (total_pnl / total_cost * 100) if total_cost > 0 else Decimal("0")

    if missing_price_symbols:
        logger.warning(f"Portfolio {portfolio.id} missing price data for: {missing_price_symbols}")

    return PortfolioValueResponse(
        portfolio_id=portfolio.id,
        portfolio_name=portfolio.name,
        as_of_date=as_of,
        total_value=total_value,
        total_cost=total_cost,
        total_pnl=total_pnl,
        total_pnl_pct=total_pnl_pct,
        holdings=holdings_detail
    )


@router.post("/risk-metrics", response_model=RiskMetricsResponse)
def get_risk_metrics(
    request: RiskMetricsRequest,
    portfolio: Portfolio = Depends(get_portfolio_view),
    db: Session = Depends(get_db)
):
    """Get risk metrics - requires view access."""
    logger.info(f"Calculating risk metrics for portfolio {portfolio.id}, lookback={request.lookback_days}, confidence={request.confidence_level}")
    
    calculator = get_risk_calculator(db)
    result = calculator.calculate_portfolio_risk(
        portfolio_id=portfolio.id,
        lookback_days=request.lookback_days,
        confidence_level=request.confidence_level
    )
    
    if not result:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    
    if "error" in result:
        logger.error(f"Risk calculation error for portfolio {portfolio.id}: {result['error']}")
        raise HTTPException(status_code=400, detail=result["error"])
    
    logger.info(f"Risk metrics calculated successfully for portfolio {portfolio.id}")
    
    return RiskMetricsResponse(
        portfolio_id=result["portfolio_id"],
        portfolio_name=result["portfolio_name"],
        as_of_date=result["as_of_date"],
        lookback_days=result["lookback_days"],
        confidence_level=result["confidence_level"],
        portfolio_volatility=Decimal(str(round(result["portfolio_volatility"], 6))),
        var_95=Decimal(str(round(result["var_historical"], 6))),
        cvar_95=Decimal(str(round(result["var_parametric"], 6))),
        max_drawdown=Decimal(str(round(result["max_drawdown"], 6))),
        sharpe_ratio=Decimal(str(round(result["sharpe_ratio"], 4))) if result["sharpe_ratio"] is not None else None,
        holdings_var_contribution=result.get("holdings_var_contribution", [])
    )


@router.post("/{symbol}", response_model=PriceIngestResponse)
def ingest_single_price(
    symbol: str,
    start_date: date = Query(...),
    end_date: date = Query(...),
    db: Session = Depends(get_db)
):
    """Single symbol ingest - public endpoint (no auth required)."""
    symbol = symbol.upper()
    logger.info(f"Single symbol ingest requested for {symbol}, date range: {start_date} to {end_date}")
    
    existing_count = db.query(func.count(PriceHistory.id)).filter(
        PriceHistory.symbol == symbol,
        PriceHistory.date >= start_date,
        PriceHistory.date <= end_date
    ).scalar()
    
    if existing_count > 0:
        logger.info(f"Skipping {symbol}: {existing_count} records already exist")
        return PriceIngestResponse(
            symbol=symbol,
            records_ingested=0,
            date_range=f"{start_date} to {end_date}",
            skipped=True
        )

    records = yfinance_service.fetch_price_history(symbol, start_date, end_date)
    if not records:
        logger.warning(f"No data returned from yfinance for {symbol}")
        raise HTTPException(
            status_code=400,
            detail=f"No data found for symbol {symbol}. Invalid ticker, rate limited, or no data available."
        )

    ingested = 0
    for record in records:
        stmt = (
            db.query(PriceHistory)
            .filter(
                PriceHistory.symbol == record["symbol"],
                PriceHistory.date == record["date"]
            )
            .first()
        )
        if not stmt:
            ph = PriceHistory(**record)
            db.add(ph)
            ingested += 1
    
    try:
        db.commit()
        logger.info(f"Successfully ingested {ingested} records for {symbol}")
    except Exception as e:
        db.rollback()
        logger.error(f"Database error ingesting {symbol}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    
    return PriceIngestResponse(
        symbol=symbol,
        records_ingested=ingested,
        date_range=f"{start_date} to {end_date}",
        skipped=False
    )