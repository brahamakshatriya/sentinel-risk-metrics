import numpy as np
import pandas as pd
from typing import Union, Optional


def annualized_volatility(
    returns: Union[pd.Series, np.ndarray],
    trading_days: int = 252
) -> float:
    """
    Calculate annualized volatility from daily returns.
    
    Args:
        returns: Series or array of daily returns (as decimals)
        trading_days: Number of trading days per year (default 252 for US equities)
        
    Returns:
        Annualized volatility as a decimal (e.g., 0.15 = 15%)
    """
    if len(returns) < 2:
        raise ValueError("Need at least 2 observations for volatility calculation")
    
    returns_array = np.asarray(returns)
    daily_vol = np.std(returns_array, ddof=1)
    return daily_vol * np.sqrt(trading_days)


def rolling_volatility(
    returns: pd.Series,
    window: int = 63,
    trading_days: int = 252
) -> pd.Series:
    """
    Calculate rolling annualized volatility.
    
    Args:
        returns: Series of daily returns indexed by date
        window: Rolling window in days (default 63 = ~3 months)
        trading_days: Trading days per year for annualization
        
    Returns:
        Series of annualized volatility indexed by date
    """
    if len(returns) < window:
        raise ValueError(f"Need at least {window} observations for rolling window")
    
    daily_vol = returns.rolling(window=window).std(ddof=1)
    return daily_vol * np.sqrt(trading_days)


def realized_volatility(
    returns: Union[pd.Series, np.ndarray],
    window: Optional[int] = None
) -> float:
    """
    Calculate realized volatility (sum of squared returns sqrt).
    If window is provided, uses only the last 'window' observations.
    
    Args:
        returns: Series or array of daily returns
        window: Optional lookback window
        
    Returns:
        Realized volatility as decimal
    """
    returns_array = np.asarray(returns)
    
    if window is not None:
        if window > len(returns_array):
            raise ValueError(f"Window ({window}) exceeds data length ({len(returns_array)})")
        returns_array = returns_array[-window:]
    
    return np.sqrt(np.sum(returns_array ** 2)) * np.sqrt(252 / len(returns_array))