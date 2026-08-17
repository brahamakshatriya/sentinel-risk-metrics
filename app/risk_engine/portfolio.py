import numpy as np
import pandas as pd
from typing import Union, Dict, List, Optional, Tuple

from .returns import calculate_daily_returns, calculate_portfolio_returns
from .var import historical_var, parametric_var, expected_shortfall
from .volatility import annualized_volatility, realized_volatility
from .performance import (
    sharpe_ratio, sortino_ratio, calmar_ratio,
    max_drawdown, max_drawdown_duration
)


def correlation_matrix(returns_df: pd.DataFrame) -> pd.DataFrame:
    """
    Calculate correlation matrix of returns.
    
    Args:
        returns_df: DataFrame with dates as index, tickers as columns
        
    Returns:
        Correlation matrix DataFrame
    """
    return returns_df.corr()


def covariance_matrix(returns_df: pd.DataFrame, trading_days: int = 252) -> pd.DataFrame:
    """
    Calculate annualized covariance matrix.
    
    Args:
        returns_df: DataFrame with dates as index, tickers as columns
        trading_days: Trading days per year for annualization
        
    Returns:
        Annualized covariance matrix
    """
    return returns_df.cov() * trading_days


def portfolio_volatility(
    weights: np.ndarray,
    cov_matrix: pd.DataFrame
) -> float:
    """
    Calculate portfolio volatility from weights and covariance matrix.
    
    Args:
        weights: 1D array of portfolio weights
        cov_matrix: Covariance matrix (tickers must match weights order)
        
    Returns:
        Portfolio volatility (annualized) as decimal
    """
    if len(weights) != len(cov_matrix):
        raise ValueError("Weights length must match covariance matrix dimension")
    
    port_var = weights.T @ cov_matrix.values @ weights
    return np.sqrt(port_var)


def component_var(
    weights: np.ndarray,
    cov_matrix: pd.DataFrame,
    portfolio_vol: float
) -> np.ndarray:
    """
    Calculate Component VaR (marginal contribution to portfolio VaR).
    
    Args:
        weights: Portfolio weights
        cov_matrix: Covariance matrix
        portfolio_vol: Total portfolio volatility
        
    Returns:
        Array of component VaR for each asset
    """
    if portfolio_vol == 0:
        return np.zeros(len(weights))
    
    # Marginal VaR = (Cov * w) / sigma_p
    marg_var = cov_matrix.values @ weights / portfolio_vol
    # Component VaR = weight * marginal VaR
    comp_var = weights * marg_var
    return comp_var


def marginal_var(
    weights: np.ndarray,
    cov_matrix: pd.DataFrame,
    portfolio_vol: float
) -> np.ndarray:
    """
    Calculate Marginal VaR for each asset.
    
    Args:
        weights: Portfolio weights
        cov_matrix: Covariance matrix
        portfolio_vol: Total portfolio volatility
        
    Returns:
        Array of marginal VaR for each asset
    """
    if portfolio_vol == 0:
        return np.zeros(len(weights))
    return cov_matrix.values @ weights / portfolio_vol


def risk_budget(
    weights: np.ndarray,
    cov_matrix: pd.DataFrame
) -> pd.Series:
    """
    Calculate risk budget (% contribution to portfolio volatility) for each asset.
    
    Args:
        weights: Portfolio weights
        cov_matrix: Covariance matrix
        
    Returns:
        Series of risk contributions summing to 1.0
    """
    port_vol = portfolio_volatility(weights, cov_matrix)
    comp_var = component_var(weights, cov_matrix, port_vol)
    return pd.Series(comp_var / port_vol, index=cov_matrix.index, name="risk_contribution")


def calculate_portfolio_metrics(
    returns_df: pd.DataFrame,
    weights: np.ndarray,
    risk_free_rate: float = 0.02,
    confidence_level: float = 0.95,
    trading_days: int = 252
) -> Dict:
    """
    Calculate comprehensive portfolio risk/performance metrics.
    
    Args:
        returns_df: DataFrame of daily returns (dates index, tickers columns)
        weights: Portfolio weights (1D array summing to 1)
        risk_free_rate: Annual risk-free rate
        confidence_level: VaR/ES confidence level
        trading_days: Trading days per year
        
    Returns:
        Dictionary of all portfolio metrics
    """
    # Portfolio returns
    port_returns = calculate_portfolio_returns(returns_df, weights)
    
    # Basic stats
    total_return = (1 + port_returns).prod() - 1
    n_years = len(port_returns) / trading_days
    annual_return = (1 + total_return) ** (1 / n_years) - 1 if n_years > 0 else 0
    
    # Risk metrics
    vol = annualized_volatility(port_returns, trading_days)
    var_95 = historical_var(port_returns, confidence_level)
    es_95 = expected_shortfall(port_returns, confidence_level)
    mdd = max_drawdown(port_returns)
    mdd_duration = max_drawdown_duration(port_returns)
    
    # Performance ratios
    sharpe = sharpe_ratio(port_returns, risk_free_rate, trading_days)
    sortino = sortino_ratio(port_returns, risk_free_rate, trading_days)
    calmar = calmar_ratio(port_returns, trading_days)
    
    # Risk decomposition
    cov_matrix = covariance_matrix(returns_df, trading_days)
    port_vol = portfolio_volatility(weights, cov_matrix)
    risk_contrib = risk_budget(weights, cov_matrix)
    marg_var = marginal_var(weights, cov_matrix, port_vol)
    comp_var = component_var(weights, cov_matrix, port_vol)
    
    return {
        "total_return": total_return,
        "annual_return": annual_return,
        "annual_volatility": vol,
        "var_95": var_95,
        "expected_shortfall_95": es_95,
        "max_drawdown": mdd,
        "max_drawdown_duration": mdd_duration,
        "sharpe_ratio": sharpe,
        "sortino_ratio": sortino,
        "calmar_ratio": calmar,
        "portfolio_volatility": port_vol,
        "risk_contributions": risk_contrib.to_dict(),
        "marginal_var": dict(zip(returns_df.columns, marg_var)),
        "component_var": dict(zip(returns_df.columns, comp_var)),
    }


def stress_test_portfolio(
    returns_df: pd.DataFrame,
    weights: np.ndarray,
    scenarios: Dict[str, Dict[str, float]]
) -> Dict[str, float]:
    """
    Run stress tests on portfolio under hypothetical scenarios.
    
    Args:
        returns_df: Historical returns DataFrame
        weights: Portfolio weights
        scenarios: Dict of scenario_name -> {ticker: shock_return}
        
    Returns:
        Dict of scenario_name -> portfolio_return
    """
    port_returns = calculate_portfolio_returns(returns_df, weights)
    mean_returns = returns_df.mean()
    
    results = {}
    for scenario_name, shocks in scenarios.items():
        # Apply shocks to affected assets, keep others at historical mean
        scenario_returns = mean_returns.copy()
        for ticker, shock in shocks.items():
            if ticker in scenario_returns.index:
                scenario_returns[ticker] = shock
        
        port_shock = (scenario_returns * weights).sum()
        results[scenario_name] = port_shock
    
    return results


def apply_market_shock(
    returns_df: pd.DataFrame,
    weights: np.ndarray,
    market_drop_pct: float,
    vol_spike_pct: float
) -> Tuple[float, float]:
    """
    Apply a market shock scenario and return shocked VaR and volatility.
    
    This is an illustrative stress test that applies:
    - A uniform market drop to all asset returns
    - A volatility multiplier to all asset volatilities
    
    Args:
        returns_df: Historical returns DataFrame
        weights: Portfolio weights
        market_drop_pct: Market drop percentage (e.g., -0.20 for 20% drop)
        vol_spike_pct: Volatility spike percentage (e.g., 0.50 for 50% increase)
        
    Returns:
        Tuple of (shocked_var_95, shocked_volatility)
    """
    # Apply market drop to all returns (shift mean)
    shocked_returns = returns_df + market_drop_pct / 252  # Daily adjustment
    
    # Apply volatility spike (scale deviations from mean)
    mean_returns = returns_df.mean()
    for col in returns_df.columns:
        shocked_returns[col] = mean_returns[col] + (returns_df[col] - mean_returns[col]) * (1 + vol_spike_pct)
    
    # Recalculate portfolio returns with shocked data
    portfolio_returns = calculate_portfolio_returns(shocked_returns, weights)
    
    # Calculate shocked metrics
    from .volatility import annualized_volatility
    from .var import historical_var
    
    shocked_vol = annualized_volatility(portfolio_returns)
    shocked_var = historical_var(portfolio_returns, 0.95)
    
    return float(shocked_var), float(shocked_vol)