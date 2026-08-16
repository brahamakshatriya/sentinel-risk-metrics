import yfinance as yf
import pandas as pd
from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional, Dict, Any
import logging

logger = logging.getLogger(__name__)


class YFinanceService:
    def __init__(self):
        self.cache = {}

    def fetch_price_history(
        self,
        symbol: str,
        start_date: date,
        end_date: date,
        interval: str = "1d"
    ) -> List[Dict[str, Any]]:
        try:
            ticker = yf.Ticker(symbol)
            hist = ticker.history(
                start=start_date,
                end=end_date + pd.Timedelta(days=1),
                interval=interval,
                auto_adjust=False
            )

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
            logger.error(f"Error fetching data for {symbol}: {str(e)}")
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
        try:
            ticker = yf.Ticker(symbol)
            info = ticker.info
            price = info.get("currentPrice") or info.get("regularMarketPrice")
            if price:
                return Decimal(str(round(price, 4)))
            return None
        except Exception as e:
            logger.error(f"Error getting current price for {symbol}: {str(e)}")
            return None

    def get_latest_price(self, symbol: str, as_of: date = None) -> Optional[Decimal]:
        end_date = as_of or date.today()
        start_date = end_date - pd.Timedelta(days=5)
        records = self.fetch_price_history(symbol, start_date, end_date)
        if records:
            return records[-1]["close"]
        return None


yfinance_service = YFinanceService()