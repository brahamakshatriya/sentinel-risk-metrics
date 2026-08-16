import numpy as np
import pandas as pd
from typing import Union


def sharpe_ratio(
    returns: Union[pd.Series, np.ndarray],
    risk_free_rate: float = 0.02,
    trading_days: int = 252
) -> float:
    """
    Calculate annualized Sharpe Ratio.
    
    Args:
        returns: Daily returns (as decimals, e.g., 0.01 for 1%)
        risk_free_rate: Annual risk-free rate (e.g., 0.02 for 2%)
        trading_days: Trading days per year
        
    Returns:
        Sharpe ratio (can be negative)
    """
    if len(returns) < 2:
        raise ValueError("Need at least 2 observations for Sharpe ratio")
    
    returns_array = np.asarray(returns)
    daily_rf = (1 + risk_free_rate) ** (1 / trading_days) - 1
    excess_returns = returns_array - daily_rf
    
    mean_excess = np.mean(excess_returns)
    std_excess = np.std(excess_returns, ddof=1)
    
    if std_excess == 0:
        return 0.0
    
    daily_sharpe = mean_excess / std_excess
    return daily_sharpe * np.sqrt(trading_days)


def sortino_ratio(
    returns: Union[pd.Series, np.ndarray],
    risk_free_rate: float = 0.02,
    trading_days: int = 252
) -> float:
    """
    Calculate annualized Sortino Ratio (uses downside deviation).
    
    Args:
        returns: Daily returns (as decimals)
        risk_free_rate: Annual risk-free rate
        trading_days: Trading days per year
        
    Returns:
        Sortino ratio
    """
    if len(returns) < 2:
        raise ValueError("Need at least 2 observations for Sortino ratio")
    
    returns_array = np.asarray(returns)
    daily_rf = (1 + risk_free_rate) ** (1 / trading_days) - 1
    excess_returns = returns_array - daily_rf
    
    downside_returns = excess_returns[excess_returns < 0]
    if len(downside_returns) == 0:
        return np.inf  # No downside risk
    
    downside_deviation = np.sqrt(np.mean(downside_returns ** 2))
    if downside_deviation == 0:
        return np.inf
    
    mean_excess = np.mean(excess_returns)
    daily_sortino = mean_excess / downside_deviation
    return daily_sortino * np.sqrt(trading_days)


def calmar_ratio(
    returns: Union[pd.Series, np.ndarray],
    trading_days: int = 252
) -> float:
    """
    Calculate Calmar Ratio = Annualized Return / Max Drawdown.
    
    Args:
        returns: Daily returns (as decimals)
        trading_days: Trading days per year
        
    Returns:
        Calmar ratio
    """
    if len(returns) < 2:
        raise ValueError("Need at least 2 observations for Calmar ratio")
    
    returns_array = np.asarray(returns)
    
    # Annualized return
    cum_returns = np.cumprod(1 + returns_array)
    total_return = cum_returns[-1] - 1
    n_years = len(returns_array) / trading_days
    annual_return = (1 + total_return) ** (1 / n_years) - 1 if n_years > 0 else 0
    
    # Max drawdown
    running_max = np.maximum.accumulate(cum_returns)
    drawdown = (running_max - cum_returns) / running_max
    max_dd = np.max(drawdown)
    
    if max_dd == 0:
        return np.inf
    
    return annual_return / max_dd


def max_drawdown(returns: Union[pd.Series, np.ndarray]) -> float:
    """
    Calculate maximum drawdown from peak.
    
    Args:
        returns: Daily returns (as decimals)
        
    Returns:
        Maximum drawdown as a positive decimal (e.g., 0.20 = 20% drawdown)
    """
    returns_array = np.asarray(returns)
    cum_returns = np.cumprod(1 + returns_array)
    running_max = np.maximum.accumulate(cum_returns)
    drawdown = (running_max - cum_returns) / running_max
    return np.max(drawdown)


def max_drawdown_duration(returns: Union[pd.Series, np.ndarray]) -> int:
    """
    Calculate the maximum duration of a drawdown period (in days).
    
    Args:
        returns: Daily returns (as decimals)
        
    Returns:
        Maximum drawdown duration in days
    """
    returns_array = np.asarray(returns)
    cum_returns = np.cumprod(1 + returns_array)
    running_max = np.maximum.accumulate(cum_returns)
    
    in_drawdown = cum_returns < running_max
    drawdown_durations = []
    current_duration = 0
    
    for is_dd in in_drawdown:
        if is_dd:
            current_duration += 1
        else:
            if current_duration > 0:
                drawdown_durations.append(current_duration)
            current_duration = 0
    
    if current_duration > 0:
        drawdown_durations.append(current_duration)
    
    return max(drawdown_durations) if drawdown_durations else 0