import os
import logging
from datetime import datetime, timedelta
from typing import Optional
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

FRED_API_KEY = os.getenv("FRED_API_KEY")

# In-memory cache
_risk_free_cache = {
    "rate": None,
    "fetched_at": None
}

CACHE_TTL_HOURS = 24
DEFAULT_RATE = 0.05
FRED_SERIES_ID = "DTB3"  # 3-Month Treasury Bill: Secondary Market Rate


def _fetch_from_fred() -> Optional[float]:
    """Fetch the latest 3-month T-bill rate from FRED API."""
    if not FRED_API_KEY:
        logger.warning("FRED_API_KEY not set, using default risk-free rate")
        return None
    
    try:
        from fredapi import Fred
        fred = Fred(api_key=FRED_API_KEY)
        
        # Get the latest observation for DTB3
        series = fred.get_series(FRED_SERIES_ID, limit=1)
        
        if series is None or series.empty:
            logger.warning("FRED returned empty series for DTB3")
            return None
        
        # FRED returns percentage (e.g., 5.25 for 5.25%), convert to decimal
        latest_value = float(series.iloc[-1]) / 100.0
        
        if latest_value < 0 or latest_value > 1:
            logger.warning(f"FRED returned unexpected rate value: {latest_value}")
            return None
            
        logger.info(f"Fetched risk-free rate from FRED: {latest_value:.4%}")
        return latest_value
        
    except Exception as e:
        logger.warning(f"Failed to fetch from FRED API: {e}, using default rate")
        return None


def _fetch_from_db(db: Session) -> Optional[float]:
    """Try to fetch from database cache."""
    from app.models import RiskFreeRateCache
    
    try:
        record = db.query(RiskFreeRateCache).filter(
            RiskFreeRateCache.series_id == FRED_SERIES_ID
        ).order_by(RiskFreeRateCache.fetched_at.desc()).first()
        
        if record and record.fetched_at > datetime.utcnow() - timedelta(hours=CACHE_TTL_HOURS):
            logger.info(f"Using cached risk-free rate from DB: {record.rate:.4%}")
            return float(record.rate)
    except Exception as e:
        logger.warning(f"Failed to fetch from DB cache: {e}")
    
    return None


def _save_to_db(db: Session, rate: float) -> None:
    """Save the fetched rate to database cache."""
    from app.models import RiskFreeRateCache
    
    try:
        record = RiskFreeRateCache(
            series_id=FRED_SERIES_ID,
            rate=rate,
            fetched_at=datetime.utcnow()
        )
        db.add(record)
        db.commit()
        logger.info(f"Saved risk-free rate to DB cache: {rate:.4%}")
    except Exception as e:
        logger.warning(f"Failed to save to DB cache: {e}")
        db.rollback()


def get_risk_free_rate(db: Optional[Session] = None) -> float:
    """
    Get the current risk-free rate (3-month T-bill yield).
    
    Priority:
    1. In-memory cache (if fresh)
    2. Database cache (if fresh)
    3. Fetch from FRED API
    4. Fallback to DEFAULT_RATE
    
    Args:
        db: Optional database session for DB cache
        
    Returns:
        Risk-free rate as decimal (e.g., 0.05 for 5%)
    """
    # Check in-memory cache first
    if _risk_free_cache["rate"] is not None and _risk_free_cache["fetched_at"] is not None:
        if _risk_free_cache["fetched_at"] > datetime.utcnow() - timedelta(hours=CACHE_TTL_HOURS):
            logger.debug(f"Using in-memory cached risk-free rate: {_risk_free_cache['rate']:.4%}")
            return _risk_free_cache["rate"]
    
    # Check database cache
    if db is not None:
        cached_rate = _fetch_from_db(db)
        if cached_rate is not None:
            _risk_free_cache["rate"] = cached_rate
            _risk_free_cache["fetched_at"] = datetime.utcnow()
            return cached_rate
    
    # Fetch from FRED
    rate = _fetch_from_fred()
    
    if rate is None:
        logger.warning(f"Using default risk-free rate: {DEFAULT_RATE:.2%}")
        rate = DEFAULT_RATE
    
    # Update caches
    _risk_free_cache["rate"] = rate
    _risk_free_cache["fetched_at"] = datetime.utcnow()
    
    if db is not None:
        _save_to_db(db, rate)
    
    return rate


def clear_cache() -> None:
    """Clear the in-memory cache (useful for testing)."""
    global _risk_free_cache
    _risk_free_cache = {
        "rate": None,
        "fetched_at": None
    }