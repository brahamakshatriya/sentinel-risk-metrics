import numpy as np
import pandas as pd
from typing import Dict, List, Optional, Tuple
from numpy.linalg import cholesky


def simulate_gbm_paths(
    current_price: float,
    mu: float,
    sigma: float,
    days: int = 252,
    num_simulations: int = 10000,
    dt: float = 1.0 / 252.0
) -> np.ndarray:
    """
    Simulate Geometric Brownian Motion price paths.
    
    GBM: S_t = S_0 * exp((mu - 0.5*sigma^2)*t + sigma*W_t)
    
    Args:
        current_price: Current spot price
        mu: Annualized drift (expected return)
        sigma: Annualized volatility
        days: Number of trading days to simulate
        num_simulations: Number of Monte Carlo paths
        dt: Time step in years (default 1/252 for daily)
        
    Returns:
        Array of shape (num_simulations, days + 1) with price paths
        First column is the current_price for all simulations
    """
    if sigma < 0:
        raise ValueError("Volatility (sigma) must be non-negative")
    
    if num_simulations <= 0:
        raise ValueError("num_simulations must be positive")
    
    # Generate all random shocks at once: shape (num_simulations, days)
    # W_t ~ N(0, sqrt(dt))
    shocks = np.random.normal(0, np.sqrt(dt), size=(num_simulations, days))
    
    # Drift term
    drift = (mu - 0.5 * sigma**2) * dt
    
    # Log returns for each step
    log_returns = drift + sigma * shocks
    
    # Cumulative log returns
    cum_log_returns = np.cumsum(log_returns, axis=1)
    
    # Add initial price column (t=0)
    # Price path: S_0 * exp(cum_log_returns)
    price_paths = current_price * np.exp(
        np.hstack([np.zeros((num_simulations, 1)), cum_log_returns])
    )
    
    return price_paths


def simulate_portfolio_paths(
    holdings_data: List[Dict],
    correlation_matrix: np.ndarray,
    days: int = 252,
    num_simulations: int = 10000,
    dt: float = 1.0 / 252.0
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Simulate correlated portfolio paths using Cholesky decomposition.
    
    Args:
        holdings_data: List of dicts with keys:
            - 'symbol': ticker symbol
            - 'weight': portfolio weight (sums to 1)
            - 'mu': annualized expected return for this holding
            - 'sigma': annualized volatility for this holding
            - 'current_price': current price per share
            - 'quantity': number of shares held
        correlation_matrix: Correlation matrix of returns (n_assets x n_assets)
        days: Number of trading days to simulate
        num_simulations: Number of Monte Carlo paths
        dt: Time step in years
        
    Returns:
        Tuple of (portfolio_values, asset_values)
        - portfolio_values: shape (num_simulations, days + 1) - portfolio value at each day
        - asset_values: shape (num_simulations, days + 1, n_assets) - individual asset values
    """
    n_assets = len(holdings_data)
    
    if n_assets == 0:
        raise ValueError("No holdings provided")
    
    if correlation_matrix.shape != (n_assets, n_assets):
        raise ValueError(f"Correlation matrix must be {n_assets}x{n_assets}")
    
    # Extract parameters
    weights = np.array([h['weight'] for h in holdings_data])
    mus = np.array([h['mu'] for h in holdings_data])
    sigmas = np.array([h['sigma'] for h in holdings_data])
    current_prices = np.array([h['current_price'] for h in holdings_data])
    quantities = np.array([h['quantity'] for h in holdings_data])
    
    # Current portfolio value per asset
    current_values = current_prices * quantities
    
    # Validate correlation matrix is positive semi-definite
    # (Cholesky will fail if not)
    try:
        L = cholesky(correlation_matrix)
    except np.linalg.LinAlgError:
        # Add small regularization if needed
        reg_corr = correlation_matrix + np.eye(n_assets) * 1e-6
        L = cholesky(reg_corr)
    
    # Generate correlated random shocks: (num_simulations, days, n_assets)
    shocks = np.random.normal(0, np.sqrt(dt), size=(num_simulations, days, n_assets))
    
    # Apply Cholesky to get correlated shocks
    # shocks @ L.T gives shape (num_simulations, days, n_assets)
    correlated_shocks = shocks @ L.T
    
    # Simulate each asset
    asset_values = np.zeros((num_simulations, days + 1, n_assets))
    
    for i in range(n_assets):
        drift = (mus[i] - 0.5 * sigmas[i]**2) * dt
        log_returns = drift + sigmas[i] * correlated_shocks[:, :, i]
        cum_log_returns = np.cumsum(log_returns, axis=1)
        
        # Price paths
        price_paths = current_prices[i] * np.exp(
            np.hstack([np.zeros((num_simulations, 1)), cum_log_returns])
        )
        
        # Convert to value paths (quantity * price)
        asset_values[:, :, i] = price_paths * quantities[i]
    
    # Portfolio values = sum of asset values
    portfolio_values = np.sum(asset_values, axis=2)
    
    return portfolio_values, asset_values


def monte_carlo_var(
    simulated_final_values: np.ndarray,
    current_value: float,
    confidence_level: float = 0.95
) -> float:
    """
    Calculate VaR from Monte Carlo simulated final portfolio values.
    
    VaR = -percentile(P&L_distribution, 1 - confidence_level)
    where P&L = final_value - current_value (negative = loss)
    
    Args:
        simulated_final_values: Array of final portfolio values from simulations
        current_value: Current portfolio value
        confidence_level: Confidence level (e.g., 0.95 for 95% VaR)
        
    Returns:
        VaR as a positive dollar amount (potential loss)
    """
    if len(simulated_final_values) == 0:
        raise ValueError("No simulated values provided")
    
    # P&L = final - current (negative = loss)
    pnl = simulated_final_values - current_value
    
    alpha = 1 - confidence_level
    # VaR is the negative of the (1-confidence) percentile of P&L
    var = -np.percentile(pnl, alpha * 100)
    
    return max(var, 0.0)


def monte_carlo_cvar(
    simulated_final_values: np.ndarray,
    current_value: float,
    confidence_level: float = 0.95
) -> float:
    """
    Calculate Conditional VaR (Expected Shortfall) from Monte Carlo simulations.
    
    CVaR = E[loss | loss > VaR]
    
    Args:
        simulated_final_values: Array of final portfolio values from simulations
        current_value: Current portfolio value
        confidence_level: Confidence level (e.g., 0.95 for 95% CVaR)
        
    Returns:
        CVaR as a positive dollar amount
    """
    if len(simulated_final_values) == 0:
        raise ValueError("No simulated values provided")
    
    # P&L = final - current (negative = loss)
    pnl = simulated_final_values - current_value
    
    alpha = 1 - confidence_level
    var = monte_carlo_var(simulated_final_values, current_value, confidence_level)
    
    # VaR is positive (loss), so losses are negative P&L
    # Losses beyond VaR: P&L < -VaR (more negative than -VaR)
    # Since VaR >= 0, -VaR <= 0
    loss_threshold = -var  # negative or zero
    tail_losses = -pnl[pnl <= loss_threshold]
    
    if len(tail_losses) == 0:
        return float(var)
    
    cvar = np.mean(tail_losses)
    return float(cvar)


def monte_carlo_summary(
    simulated_final_values: np.ndarray,
    current_value: float,
    confidence_level: float = 0.95
) -> Dict:
    """
    Generate summary statistics from Monte Carlo simulations.
    
    Args:
        simulated_final_values: Array of final portfolio values
        current_value: Current portfolio value
        confidence_level: Confidence level for VaR/CVaR
        
    Returns:
        Dictionary with summary statistics
    """
    returns = (simulated_final_values - current_value) / current_value
    
    var = monte_carlo_var(simulated_final_values, current_value, confidence_level)
    cvar = monte_carlo_cvar(simulated_final_values, current_value, confidence_level)
    
    return {
        "mean_final_value": float(np.mean(simulated_final_values)),
        "median_final_value": float(np.median(simulated_final_values)),
        "std_final_value": float(np.std(simulated_final_values)),
        "var": float(var),
        "cvar": float(cvar),
        "var_pct": float(var / current_value) if current_value > 0 else 0.0,
        "cvar_pct": float(cvar / current_value) if current_value > 0 else 0.0,
        "percentiles": {
            "p5": float(np.percentile(simulated_final_values, 5)),
            "p25": float(np.percentile(simulated_final_values, 25)),
            "p50": float(np.percentile(simulated_final_values, 50)),
            "p75": float(np.percentile(simulated_final_values, 75)),
            "p95": float(np.percentile(simulated_final_values, 95)),
        },
        "return_percentiles": {
            "p5": float(np.percentile(returns, 5)),
            "p25": float(np.percentile(returns, 25)),
            "p50": float(np.percentile(returns, 50)),
            "p75": float(np.percentile(returns, 75)),
            "p95": float(np.percentile(returns, 95)),
        },
        "prob_loss": float(np.mean(returns < 0)),
        "prob_gain": float(np.mean(returns > 0)),
    }


def simulate_gbm_paths_vectorized(
    current_price: float,
    mu: float,
    sigma: float,
    days: int,
    num_simulations: int,
    dt: float = 1.0 / 252.0
) -> np.ndarray:
    """
    Vectorized GBM simulation - same as simulate_gbm_paths but explicitly 
    named to emphasize it uses fully vectorized numpy operations.
    """
    return simulate_gbm_paths(current_price, mu, sigma, days, num_simulations, dt)