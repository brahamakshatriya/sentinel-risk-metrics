import pandas as pd
import numpy as np
from typing import Union


def calculate_daily_returns(price_series: Union[pd.Series, pd.DataFrame]) -> Union[pd.Series, pd.DataFrame]:
    """
    Calculate daily percentage returns from price series.
    
    Args:
        price_series: Series or DataFrame of prices indexed by date
        
    Returns:
        Series or DataFrame of daily percentage returns (same index, shifted by 1 day)
    """
    if isinstance(price_series, pd.Series):
        returns = price_series.pct_change()
        returns.name = "returns"
        return returns.dropna()
    else:
        returns = price_series.pct_change()
        return returns.dropna(how="all")


def calculate_portfolio_returns(returns_df: pd.DataFrame, weights: np.ndarray) -> pd.Series:
    """
    Calculate weighted portfolio returns from individual asset returns.
    
    Args:
        returns_df: DataFrame with dates as index, tickers as columns
        weights: 1D numpy array of weights summing to 1.0 (order must match returns_df columns)
        
    Returns:
        Series of portfolio daily returns indexed by date
    """
    if returns_df.empty:
        raise ValueError("Returns DataFrame is empty")
    
    if len(weights) != len(returns_df.columns):
        raise ValueError(f"Number of weights ({len(weights)}) must match number of return series ({len(returns_df.columns)})")
    
    if not np.isclose(np.sum(weights), 1.0):
        raise ValueError(f"Weights must sum to 1.0, got {np.sum(weights):.6f}")
    
    portfolio_returns = returns_df.dot(weights)
    portfolio_returns.name = "portfolio_returns"
    return portfolio_returns


def align_returns(returns_dict: dict[str, pd.Series]) -> pd.DataFrame:
    """
    Align multiple return series by date, filling missing dates with NaN.
    Useful when tickers have different trading calendars.
    
    Args:
        returns_dict: Dict mapping ticker to return Series
        
    Returns:
        DataFrame with aligned dates (outer join) and tickers as columns
    """
    if not returns_dict:
        return pd.DataFrame()
    
    return pd.DataFrame(returns_dict).sort_index()