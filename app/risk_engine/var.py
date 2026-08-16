import numpy as np
import pandas as pd
from scipy import stats
from typing import Union


def historical_var(
    returns: Union[pd.Series, np.ndarray],
    confidence_level: float = 0.95
) -> float:
    """
    Calculate Historical Value at Risk (VaR) using empirical percentile method.
    
    Args:
        returns: Series or array of portfolio returns (daily, as decimals e.g., 0.01 = 1%)
        confidence_level: Confidence level (e.g., 0.95 for 95% VaR)
        
    Returns:
        VaR as a positive decimal (e.g., 0.025 = 2.5% loss at given confidence)
        
    Note:
        Returns positive value representing potential loss.
        For 95% VaR with returns [-0.02, -0.01, 0.0, 0.01, 0.02], 
        percentile at 5% is -0.01, VaR = 0.01 (1% loss)
    """
    if len(returns) < 2:
        raise ValueError("Need at least 2 observations for VaR calculation")
    
    returns_array = np.asarray(returns)
    alpha = 1 - confidence_level
    var_percentile = np.percentile(returns_array, alpha * 100)
    return -var_percentile  # Return as positive loss value


def parametric_var(
    returns: Union[pd.Series, np.ndarray],
    confidence_level: float = 0.95
) -> float:
    """
    Calculate Parametric (Variance-Covariance) VaR assuming normal distribution.
    
    Args:
        returns: Series or array of portfolio returns (daily, as decimals)
        confidence_level: Confidence level (e.g., 0.95 for 95% VaR)
        
    Returns:
        VaR as a positive decimal
        
    Note:
        Uses portfolio mean and std with z-score from standard normal distribution.
        VaR = -(mean + z * std) where z is negative for left tail.
    """
    if len(returns) < 2:
        raise ValueError("Need at least 2 observations for VaR calculation")
    
    returns_array = np.asarray(returns)
    mean = np.mean(returns_array)
    std = np.std(returns_array, ddof=1)
    
    z_score = stats.norm.ppf(1 - confidence_level)
    var = -(mean + z_score * std)
    return max(var, 0.0)  # VaR should be non-negative


def expected_shortfall(
    returns: Union[pd.Series, np.ndarray],
    confidence_level: float = 0.95
) -> float:
    """
    Calculate Expected Shortfall (Conditional VaR) - average loss beyond VaR threshold.
    
    Args:
        returns: Series or array of portfolio returns
        confidence_level: Confidence level (e.g., 0.95 for 95% ES)
        
    Returns:
        Expected Shortfall as a positive decimal
    """
    if len(returns) < 2:
        raise ValueError("Need at least 2 observations for ES calculation")
    
    returns_array = np.asarray(returns)
    var = historical_var(returns_array, confidence_level)
    alpha = 1 - confidence_level
    tail_losses = returns_array[returns_array <= -var]
    
    if len(tail_losses) == 0:
        return var
    
    return -np.mean(tail_losses)