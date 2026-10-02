import yfinance as yf
import pandas as pd
from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional, Dict, Any
import logging

from app.security import resource_limits as limits
from app.security.upstream import cap_retries, is_transient_upstream

logger = logging.getLogger(__name__)

# Resolved once at import; tests monkeypatch module attributes directly.
_YAHOO_TIMEOUT = float(limits.YAHOO_TIMEOUT_SECONDS)
_YAHOO_RETRIES = cap_retries(limits.YAHOO_MAX_RETRIES)


def _timeout_seconds() -> float:
    return float(_YAHOO_TIMEOUT)


def _max_retries() -> int:
    return cap_retries(_YAHOO_RETRIES)


class YFinanceService:
    def __init__(self):
        self.cache = {}

    def _history_with_retry(self, symbol: str, start_date: date, end_date: date,
                            interval: str = "1d"):
        """Single bounded Yahoo fetch: explicit timeout + at most ONE retry.

        Retry happens ONLY for transient network failures. Validation
        problems, empty responses, rate-limit signals, and DB errors are
        never retried. After retry exhaustion the caller sees the same
        bounded failure (empty result) as before — no behavior change
        downstream.
        """
        ticker = yf.Ticker(symbol)
        last_transient = None
        attempts = 1 + _max_retries()
        for attempt in range(attempts):
            try:
                return ticker.history(
                    start=start_date,
                    end=end_date + pd.Timedelta(days=1),
                    interval=interval,
                    auto_adjust=False,
                    timeout=_timeout_seconds(),
                )
            except Exception as e:
                if is_transient_upstream(e) and attempt + 1 < attempts:
                    last_transient = e
                    logger.warning(
                        "yahoo_transient symbol=%s attempt=%s/%s error=%s",
                        symbol, attempt + 1, attempts, type(e).__name__,
                    )
                    continue
                raise
        # Unreachable: loop either returns or raises. Kept for clarity.
        raise last_transient  # pragma: no cover

    def fetch_price_history(
        self,
        symbol: str,
        start_date: date,
        end_date: date,
        interval: str = "1d"
    ) -> List[Dict[str, Any]]:
        try:
            hist = self._history_with_retry(symbol, start_date, end_date, interval)

            if hist.empty:
                logger.warning(f"No data returned for {symbol} from {start_date} to {end_date}")
                return []

            records = []
            for idx, row in hist.iterrows():
                record = {
                    "symbol": symbol.upper(),
                    "date": idx.date(),
                    "open": Decimal(str(round(row["Open"], 4))) if pd.notna(row["Open"]) else None,
                    "high": Decimal(str(round(row["High"], 4))) if pd.notna(row["High"]) else None,
                    "low": Decimal(str(round(row["Low"], 4))) if pd.notna(row["Low"]) else None,
                    "close": Decimal(str(round(row["Close"], 4))),
                    "adjusted_close": Decimal(str(round(row.get("Adj Close", row["Close"]), 4))) if pd.notna(row.get("Adj Close", row["Close"])) else None,
                    "volume": int(row["Volume"]) if pd.notna(row["Volume"]) else None,
                }
                records.append(record)

            logger.info(f"Fetched {len(records)} records for {symbol}")
            return records

        except Exception as e:
            logger.error(f"Error fetching data for {symbol}: {type(e).__name__}")
            return []

    def fetch_multiple_symbols(
        self,
        symbols: List[str],
        start_date: date,
        end_date: date,
        interval: str = "1d"
    ) -> Dict[str, List[Dict[str, Any]]]:
        results = {}
        for symbol in symbols:
            records = self.fetch_price_history(symbol, start_date, end_date, interval)
            if records:
                results[symbol.upper()] = records
        return results

    def get_current_price(self, symbol: str) -> Optional[Decimal]:
        """NOTE: dead code path (no route calls it). Left unhardened
        intentionally; the ingestion path above is the S2-hardened one."""
        try:
            ticker = yf.Ticker(symbol)
            info = ticker.info
            price = info.get("currentPrice") or info.get("regularMarketPrice")
            if price:
                return Decimal(str(round(price, 4)))
            return None
        except Exception as e:
            logger.error(f"Error getting current price for {symbol}: {type(e).__name__}")
            return None

    def get_latest_price(self, symbol: str, as_of: date = None) -> Optional[Decimal]:
        end_date = as_of or date.today()
        start_date = end_date - pd.Timedelta(days=5)
        records = self.fetch_price_history(symbol, start_date, end_date)
        if records:
            return records[-1]["close"]
        return None


yfinance_service = YFinanceService()
