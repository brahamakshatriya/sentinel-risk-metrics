from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from typing import List, Optional
from datetime import date, datetime, timedelta
from decimal import Decimal
import logging
import re

from app.db.database import get_db
from app.models import PriceHistory, Portfolio, Holding, User
from app.schemas import (
    PriceIngestRequest, PriceIngestResponse,
    PriceHistoryResponse,
    PortfolioValueResponse, RiskMetricsRequest, RiskMetricsResponse,
    PortfolioValueRequest
)
from app.services.risk_calculator import get_risk_calculator
from app.services.yfinance_service import yfinance_service
from app.auth import get_current_user
from app.authorization import (
    get_portfolio_view, get_portfolio_edit,
    get_portfolio_access_level, AccessLevel,
)
from app.security import resource_limits as limits
from app.security.errors import (
    BudgetExceededError,
    IngestionBusyError,
)
from app.security.gates import ingest_gate
from app.security.rate_limit import (
    ANON,
    AUTH_STANDARD,
    INGEST,
    anon_key,
    client_ip,
    enforce_rate_limit,
    user_key,
)

_SYMBOL_RE = re.compile(r"^[A-Za-z0-9.\-_=^]+$")


def _insert_new_records(db, records, known_dates: set) -> int:
    """Insert records absent from known_dates; return new-row count.

    S3 race safety: the (symbol, date) unique constraint is the backstop.
    If a concurrent ingest wins the race, the bulk commit raises
    IntegrityError -> rollback -> per-record retry where raced rows are
    detected as present and skipped (never 500, never duplicates).
    Response semantics are identical to the pre-S3 loop.
    """
    fresh = [r for r in records if r["date"] not in known_dates]
    for record in fresh:
        db.add(PriceHistory(**record))
    try:
        db.commit()
        return len(fresh)
    except IntegrityError:
        db.rollback()
        logger.info("ingest_race bulk insert conflict; retrying per-record")
    ingested = 0
    for record in fresh:
        exists = db.query(PriceHistory.id).filter(
            PriceHistory.symbol == record["symbol"],
            PriceHistory.date == record["date"]
        ).first()
        if exists:
            continue
        db.add(PriceHistory(**record))
        try:
            db.commit()
            ingested += 1
        except IntegrityError:
            db.rollback()
            logger.info("ingest_race row lost for %s @ %s; skipping",
                        record["symbol"], record["date"])
    return ingested


def _existing_dates(db, symbol: str, start_date: date, end_date: date) -> set:
    """S3 N+1 fix: one range query per symbol instead of per-record SELECTs."""
    rows = db.query(PriceHistory.date).filter(
        PriceHistory.symbol == symbol,
        PriceHistory.date >= start_date,
        PriceHistory.date <= end_date
    ).all()
    return {r[0] for r in rows}


def _validate_symbol_shape(symbol: str) -> str:
    """Yahoo ticker shape check. 422 on invalid shape; never touches network."""
    s = (symbol or "").strip().upper()
    if not s or len(s) > 20 or not _SYMBOL_RE.match(s):
        raise HTTPException(status_code=422, detail=f"Invalid symbol format: {symbol!r}")
    return s


def _enforce_ingestion_budget(symbols: List[str], start_date: date, end_date: date) -> None:
    """Reject excessive ingestion BEFORE any Yahoo call. 413 on over-budget."""
    if end_date < start_date:
        raise HTTPException(status_code=422, detail="end_date must be >= start_date")
    span = limits.ingestion_span_days(start_date, end_date)
    if span > limits.INGEST_MAX_DATE_RANGE_DAYS:
        raise BudgetExceededError(
            error="ingestion_budget_exceeded",
            message=(
                f"Date range too large: {span} days exceeds maximum "
                f"{limits.INGEST_MAX_DATE_RANGE_DAYS} days (~5 years)."
            ),
            details={"span_days": span, "max_span_days": limits.INGEST_MAX_DATE_RANGE_DAYS},
        )
    symbol_days = limits.ingestion_symbol_days(len(symbols), start_date, end_date)
    if symbol_days > limits.INGEST_MAX_SYMBOL_DAYS:
        raise BudgetExceededError(
            error="ingestion_budget_exceeded",
            message=(
                f"Ingestion budget exceeded: {len(symbols)} symbols x {span} days "
                f"= {symbol_days:,} symbol-days exceeds budget "
                f"{limits.INGEST_MAX_SYMBOL_DAYS:,}."
            ),
            details={
                "symbol_days": symbol_days,
                "budget": limits.INGEST_MAX_SYMBOL_DAYS,
                "num_symbols": len(symbols),
                "span_days": span,
            },
        )


def _get_viewable_portfolio(portfolio_id: int, user: User, db) -> Portfolio:
    """
    Resolve a portfolio by id from a request BODY (not a path param).

    The shared get_portfolio_view dependency binds `portfolio_id` from the
    path, falling back to REQUIRED query param when the route has no
    {portfolio_id} segment — which made body-based POST endpoints return
    422 'Field required' at ('query', 'portfolio_id'). This helper keeps
    the identical authorization semantics (owner first, then shares)
    while reading the id from the validated request body.
    """
    portfolio = db.query(Portfolio).filter(Portfolio.id == portfolio_id).first()
    if not portfolio:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    if get_portfolio_access_level(user, portfolio, db) == AccessLevel.NONE:
        from app.security.events import security_event
        security_event("authorization_denial", user_id=user.id,
                       portfolio_id=portfolio_id, required="view", actual="none")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this portfolio"
        )
    return portfolio

router = APIRouter(prefix="/ingest", tags=["ingestion"])
logger = logging.getLogger(__name__)


@router.post("/batch", response_model=List[PriceIngestResponse])
def ingest_batch_prices(
    request: PriceIngestRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Batch ingest price data - requires authentication (SEC-001 fix).
    Price data is global/shared, so no portfolio ownership check.
    Order: Authentication -> S1 rate limit -> S3 persistent quota ->
    S1 admission -> S1 concurrency gate -> Yahoo -> record quota usage.
    """
    # 1. Rate limit (isolated INGEST bucket per user).
    enforce_rate_limit(INGEST, user_key(user.id, INGEST))
    # 2. Admission BEFORE any Yahoo call (zero upstream on reject).
    symbols = [_validate_symbol_shape(s) for s in request.symbols]
    # 3. S3 persistent business quota (pre-Yahoo; survives restarts).
    from app.security.quotas import check_ingest_quota, record_ingest_usage
    requested_days = limits.ingestion_symbol_days(
        len(symbols), request.start_date, request.end_date)
    check_ingest_quota(db, user.id, requested_days)
    _enforce_ingestion_budget(symbols, request.start_date, request.end_date)
    # 3. Bounded concurrency (non-blocking).
    gate_key = f"ingest:user:{user.id}"
    if not ingest_gate.try_acquire(gate_key):
        logger.warning(
            "ingest_rejected operation=batch user_id=%s symbols=%s reason=busy",
            user.id, len(symbols),
        )
        raise IngestionBusyError(retry_after=5)
    try:
        logger.info(f"Batch ingest requested for symbols: {request.symbols}, date range: {request.start_date} to {request.end_date}")
        results = yfinance_service.fetch_multiple_symbols(
            request.symbols, request.start_date, request.end_date
        )
    finally:
        ingest_gate.release(gate_key)

    # S3: record upstream cost AFTER the Yahoo round-trip executed
    # (dedup-skipped and pre-Yahoo-rejected requests consume nothing).
    record_ingest_usage(db, user.id, requested_days)
    
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

        known_dates = _existing_dates(db, symbol, request.start_date, request.end_date)
        try:
            ingested = _insert_new_records(db, records, known_dates)
        except Exception as e:
            db.rollback()
            logger.error(f"Database error ingesting {symbol}: {type(e).__name__}", exc_info=True)
            responses.append(PriceIngestResponse(
                symbol=symbol,
                records_ingested=0,
                date_range=f"{request.start_date} to {request.end_date}",
                skipped=False,
                error="Database error while ingesting prices"
            ))
            continue
        logger.info(f"Successfully ingested {ingested} records for {symbol}")
        
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
    request: Request,
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    limit: int = Query(1000, ge=1, le=5000),
    db: Session = Depends(get_db)
):
    """Get price history - public endpoint (cheap IP resource gate + validation)."""
    enforce_rate_limit(ANON, anon_key(client_ip(request), ANON))
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
def get_latest_price(symbol: str, request: Request, as_of: Optional[date] = Query(None), db: Session = Depends(get_db)):
    """Get latest price - public endpoint (cheap IP resource gate)."""
    enforce_rate_limit(ANON, anon_key(client_ip(request), ANON))
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
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get portfolio value - requires view access."""
    # S4: authorization precedes rate limiting (matches all path-based
    # endpoints). A stranger denied here must see 403 without consuming
    # any rate-limit budget or revealing resource state via 429s.
    portfolio = _get_viewable_portfolio(request.portfolio_id, user, db)
    enforce_rate_limit(AUTH_STANDARD, user_key(user.id, AUTH_STANDARD))
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
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get risk metrics - requires view access."""
    # S4: authorization precedes rate limiting (see portfolio-value).
    portfolio = _get_viewable_portfolio(request.portfolio_id, user, db)
    enforce_rate_limit(AUTH_STANDARD, user_key(user.id, AUTH_STANDARD))
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
        holdings_var_contribution=result.get("holdings_var_contribution", []),
        correlation_matrix=result.get("correlation_matrix", {}),
    )


@router.post("/{symbol}", response_model=PriceIngestResponse)
def ingest_single_price(
    symbol: str,
    start_date: date = Query(...),
    end_date: date = Query(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Single symbol ingest - requires authentication (SEC-001 fix)."""
    symbol = _validate_symbol_shape(symbol)
    enforce_rate_limit(INGEST, user_key(user.id, INGEST))
    # S3 persistent business quota BEFORE any Yahoo call.
    from app.security.quotas import check_ingest_quota, record_ingest_usage
    requested_days = limits.ingestion_symbol_days(1, start_date, end_date)
    check_ingest_quota(db, user.id, requested_days)
    # Admission BEFORE any Yahoo call.
    _enforce_ingestion_budget([symbol], start_date, end_date)
    logger.info(f"Single symbol ingest requested for {symbol}, date range: {start_date} to {end_date}")

    gate_key = f"ingest:user:{user.id}"
    if not ingest_gate.try_acquire(gate_key):
        logger.warning(
            "ingest_rejected operation=single user_id=%s symbol=%s reason=busy",
            user.id, symbol,
        )
        raise IngestionBusyError(retry_after=5)

    try:
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
    finally:
        ingest_gate.release(gate_key)
    # S3: record upstream cost AFTER the Yahoo round-trip executed.
    record_ingest_usage(db, user.id, requested_days)
    if not records:
        logger.warning(f"No data returned from yfinance for {symbol}")
        raise HTTPException(
            status_code=400,
            detail=f"No data found for symbol {symbol}. Invalid ticker, rate limited, or no data available."
        )

    known_dates = _existing_dates(db, symbol, start_date, end_date)
    try:
        ingested = _insert_new_records(db, records, known_dates)
    except Exception as e:
        db.rollback()
        logger.error(f"Database error ingesting {symbol}: {type(e).__name__}", exc_info=True)
        raise HTTPException(status_code=500, detail="Database error while ingesting prices")
    logger.info(f"Successfully ingested {ingested} records for {symbol}")
    
    return PriceIngestResponse(
        symbol=symbol,
        records_ingested=ingested,
        date_range=f"{start_date} to {end_date}",
        skipped=False
    )