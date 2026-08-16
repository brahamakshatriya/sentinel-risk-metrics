import sys
sys.path.insert(0, r"C:\Users\Dhananjay\Downloads\Dhruv's Pvt docs\RiskMetrics")

import pytest
import numpy as np
import pandas as pd
from datetime import date, timedelta
from scipy import stats

from app.risk_engine.returns import calculate_daily_returns, calculate_portfolio_returns
from app.risk_engine.var import historical_var, parametric_var, expected_shortfall
from app.risk_engine.volatility import annualized_volatility
from app.risk_engine.performance import (
    sharpe_ratio, sortino_ratio, calmar_ratio, max_drawdown, max_drawdown_duration
)
from app.risk_engine.portfolio import (
    correlation_matrix, covariance_matrix, portfolio_volatility, risk_budget,
    calculate_portfolio_metrics, stress_test_portfolio
)
from app.risk_engine.monte_carlo import (
    simulate_gbm_paths,
    simulate_portfolio_paths,
    monte_carlo_var,
    monte_carlo_cvar,
    monte_carlo_summary,
)


# ============================================================================
# Test Data Fixtures
# ============================================================================

@pytest.fixture
def simple_prices():
    """Simple price series with known returns for manual verification."""
    # 10 days of prices
    dates = pd.date_range('2023-01-01', periods=10, freq='D')
    # Prices: 100, 101, 102, 101, 103, 104, 102, 105, 106, 107
    prices = [100, 101, 102, 101, 103, 104, 102, 105, 106, 107]
    return pd.Series(prices, index=dates)


@pytest.fixture
def two_asset_prices():
    """Two asset price series with known correlation."""
    dates = pd.date_range('2023-01-01', periods=20, freq='D')
    np.random.seed(42)
    
    # Asset A: slight upward trend
    a_returns = np.random.normal(0.001, 0.01, 20)
    a_prices = 100 * np.cumprod(1 + a_returns)
    
    # Asset B: correlated with A (0.7 correlation)
    b_returns = 0.7 * a_returns + 0.3 * np.random.normal(0.0005, 0.01, 20)
    b_prices = 50 * np.cumprod(1 + b_returns)
    
    return pd.DataFrame({
        'A': a_prices,
        'B': b_prices
    }, index=dates)


@pytest.fixture
def known_returns():
    """Returns with known statistics for manual verification."""
    # Mean = 0.001, std = 0.02, 30 days
    np.random.seed(123)
    returns = np.random.normal(0.001, 0.02, 30)
    return pd.Series(returns, index=pd.date_range('2023-01-01', periods=30, freq='D'))


# ============================================================================
# Returns Tests
# ============================================================================

class TestReturns:
    
    def test_calculate_daily_returns_series(self, simple_prices):
        returns = calculate_daily_returns(simple_prices)
        
        assert isinstance(returns, pd.Series)
        assert len(returns) == len(simple_prices) - 1  # One less due to dropna
        
        # Manual check: 100->101 = 1%, 101->102 = 0.99%, etc.
        expected_first = (101 - 100) / 100
        assert np.isclose(returns.iloc[0], expected_first)
    
    def test_calculate_daily_returns_dataframe(self, two_asset_prices):
        returns = calculate_daily_returns(two_asset_prices)
        
        assert isinstance(returns, pd.DataFrame)
        assert len(returns) == len(two_asset_prices) - 1
        assert list(returns.columns) == ['A', 'B']
    
    def test_calculate_portfolio_returns(self, two_asset_prices):
        returns_df = calculate_daily_returns(two_asset_prices)
        weights = np.array([0.6, 0.4])
        
        port_returns = calculate_portfolio_returns(returns_df, weights)
        
        assert isinstance(port_returns, pd.Series)
        assert len(port_returns) == len(returns_df)
        
        # Check first value manually
        expected = returns_df.iloc[0].dot(weights)
        assert np.isclose(port_returns.iloc[0], expected)
    
    def test_portfolio_returns_invalid_weights(self, two_asset_prices):
        returns_df = calculate_daily_returns(two_asset_prices)
        
        with pytest.raises(ValueError, match="sum to 1.0"):
            calculate_portfolio_returns(returns_df, np.array([0.5, 0.3]))
        
        with pytest.raises(ValueError, match="Number of weights"):
            calculate_portfolio_returns(returns_df, np.array([0.5, 0.3, 0.2]))


# ============================================================================
# VaR Tests
# ============================================================================

class TestVaR:
    
    def test_historical_var_basic(self):
        # Known distribution: 5% of observations should be <= VaR at 95%
        np.random.seed(42)
        returns = np.random.normal(0, 0.01, 10000)
        
        var_95 = historical_var(returns, 0.95)
        
        # For N(0, 0.01), 95% VaR ≈ 1.645 * 0.01 = 0.01645
        assert np.isclose(var_95, 0.01645, atol=0.002)
        
        # VaR should be positive (loss)
        assert var_95 > 0
    
    def test_historical_var_percentile(self):
        # Exact test: 100 returns, 5% VaR should be 5th worst
        returns = np.arange(-0.10, 0.00, 0.001)  # -10% to 0%
        returns = np.sort(returns)
        
        var_95 = historical_var(returns, 0.95)
        # 5th percentile = index 5 (0-based), value ≈ -0.055
        expected = -returns[5]
        
        assert np.isclose(var_95, expected, atol=0.001)
    
    def test_parametric_var(self):
        np.random.seed(42)
        returns = np.random.normal(0, 0.01, 10000)
        
        var_95 = parametric_var(returns, 0.95)
        
        # Parametric VaR: -(0 + z * 0.01) where z = -1.645
        # So VaR = 0.01645
        assert np.isclose(var_95, 0.01645, atol=0.002)
        assert var_95 > 0
    
    def test_parametric_var_with_mean(self):
        # Mean = 0.001, std = 0.02
        returns = np.array([0.001 + 0.02 * z for z in np.random.randn(1000)])
        np.random.seed(42)
        returns = np.random.normal(0.001, 0.02, 1000)
        
        var_95 = parametric_var(returns, 0.95)
        
        # -(mean + z * std) = -(0.001 - 1.645 * 0.02) = 0.0319
        expected = -(0.001 + stats.norm.ppf(0.05) * 0.02)
        assert np.isclose(var_95, expected, atol=0.003)
    
    def test_expected_shortfall(self):
        np.random.seed(42)
        returns = np.random.normal(0, 0.01, 10000)
        
        es_95 = expected_shortfall(returns, 0.95)
        
        # ES > VaR for normal distribution
        var_95 = historical_var(returns, 0.95)
        assert es_95 > var_95
        
        # Theoretical ES for normal: mu - sigma * phi(z)/(1-alpha)
        # where phi is standard normal PDF
        # For N(0,0.01): ES = 0.01 * norm.pdf(norm.ppf(0.05)) / 0.05 ≈ 0.0206
        from scipy import stats
        expected_es = 0.01 * stats.norm.pdf(stats.norm.ppf(0.05)) / 0.05
        assert np.isclose(es_95, expected_es, atol=0.002)
    
    def test_var_insufficient_data(self):
        with pytest.raises(ValueError, match="at least 2"):
            historical_var([0.01])
        
        with pytest.raises(ValueError, match="at least 2"):
            parametric_var([0.01])


# ============================================================================
# Volatility Tests
# ============================================================================

class TestVolatility:
    
    def test_annualized_volatility(self):
        # Daily vol = 0.02, annualized = 0.02 * sqrt(252) ≈ 0.3175
        returns = np.random.normal(0, 0.02, 252)
        
        vol = annualized_volatility(returns)
        expected = 0.02 * np.sqrt(252)
        
        assert np.isclose(vol, expected, rtol=0.1)  # 10% tolerance for small sample
    
    def test_annualized_volatility_known(self):
        # Returns with exactly 2% daily std
        returns = pd.Series([0.02, -0.02, 0.02, -0.02] * 50)
        
        vol = annualized_volatility(returns)
        expected = 0.02 * np.sqrt(252)
        
        assert np.isclose(vol, expected, rtol=0.05)
    
    def test_volatility_insufficient_data(self):
        with pytest.raises(ValueError, match="at least 2"):
            annualized_volatility([0.01])
    
    def test_correlation_matrix(self, two_asset_prices):
        returns = calculate_daily_returns(two_asset_prices)
        corr = correlation_matrix(returns)
        
        assert isinstance(corr, pd.DataFrame)
        assert corr.shape == (2, 2)
        assert np.isclose(corr.iloc[0, 0], 1.0)
        assert np.isclose(corr.iloc[1, 1], 1.0)
        assert corr.iloc[0, 1] == corr.iloc[1, 0]
    
    def test_covariance_matrix(self, two_asset_prices):
        returns = calculate_daily_returns(two_asset_prices)
        cov = covariance_matrix(returns)
        
        assert isinstance(cov, pd.DataFrame)
        assert cov.shape == (2, 2)
        # Diagonal should be variances (annualized)
        assert cov.iloc[0, 0] > 0
        assert cov.iloc[1, 1] > 0
    
    def test_portfolio_volatility(self, two_asset_prices):
        returns = calculate_daily_returns(two_asset_prices)
        cov = covariance_matrix(returns)
        weights = np.array([0.6, 0.4])
        
        port_vol = portfolio_volatility(weights, cov)
        
        # Manual calculation: sqrt(w' * cov * w)
        expected = np.sqrt(weights @ cov.values @ weights)
        assert np.isclose(port_vol, expected)
    
    def test_risk_budget(self, two_asset_prices):
        returns = calculate_daily_returns(two_asset_prices)
        cov = covariance_matrix(returns)
        weights = np.array([0.6, 0.4])
        
        risk_contrib = risk_budget(weights, cov)
        
        assert isinstance(risk_contrib, pd.Series)
        assert np.isclose(risk_contrib.sum(), 1.0)
        assert len(risk_contrib) == 2


# ============================================================================
# Performance Ratios Tests
# ============================================================================

class TestRatios:
    
    def test_sharpe_ratio(self):
        np.random.seed(42)
        returns = np.random.normal(0.001, 0.02, 252)  # ~25% annual return, 31% vol
        
        sharpe = sharpe_ratio(returns, risk_free_rate=0.02)
        
        # Expected: (0.001*252 - 0.02) / (0.02*sqrt(252)) ≈ (0.252 - 0.02) / 0.317 ≈ 0.73
        assert sharpe > 0
        assert isinstance(sharpe, float)
    
    def test_sharpe_ratio_negative(self):
        returns = np.array([-0.01] * 100)  # Consistent losses
        
        sharpe = sharpe_ratio(returns, risk_free_rate=0.02)
        
        assert sharpe < 0
    
    def test_sortino_ratio(self):
        np.random.seed(42)
        returns = np.random.normal(0.001, 0.02, 252)
        
        sortino = sortino_ratio(returns, risk_free_rate=0.02)
        
        # Sortino >= Sharpe (since downside deviation <= total deviation)
        sharpe = sharpe_ratio(returns, risk_free_rate=0.02)
        assert sortino >= sharpe
    
    def test_sortino_no_downside(self):
        returns = np.array([0.01] * 100)  # All positive
        
        sortino = sortino_ratio(returns, risk_free_rate=0.02)
        
        assert sortino == np.inf
    
    def test_max_drawdown(self):
        # Create a series with known drawdown
        returns = pd.Series([0.01, 0.01, -0.05, 0.02, 0.01])  # Peak after 2, then -5%
        
        mdd = max_drawdown(returns)
        
        # Cumulative: 1.01, 1.0201, 0.969, 0.988, 0.998
        # Max drawdown: (1.0201 - 0.969) / 1.0201 ≈ 0.05
        assert np.isclose(mdd, 0.05, atol=0.001)
    
    def test_calmar_ratio(self):
        np.random.seed(42)
        returns = np.random.normal(0.001, 0.02, 252)
        
        calmar = calmar_ratio(returns)
        
        # Should be positive for positive returns
        assert isinstance(calmar, float)


# ============================================================================
# Edge Case Tests
# ============================================================================

class TestEdgeCases:
    
    def test_single_asset_correlation(self):
        """Single asset correlation matrix should be [[1.0]]"""
        returns = pd.Series(np.random.normal(0.001, 0.02, 100), name='A')
        returns_df = pd.DataFrame({'A': returns})
        
        corr = correlation_matrix(returns_df)
        
        assert corr.shape == (1, 1)
        assert corr.iloc[0, 0] == 1.0
    
    def test_insufficient_history(self):
        """Should raise error for less than 2 days of data."""
        returns = pd.Series([0.01] * 1)
        
        with pytest.raises(ValueError, match="at least 2"):
            annualized_volatility(returns)
        
        with pytest.raises(ValueError, match="at least 2"):
            historical_var(returns)
        
        # 20 days should work fine (just need >= 2)
        returns_20 = pd.Series([0.01] * 20)
        vol = annualized_volatility(returns_20)
        assert isinstance(vol, float)
    
    def test_weights_sum_to_one(self, two_asset_prices):
        returns = calculate_daily_returns(two_asset_prices)
        
        with pytest.raises(ValueError, match="sum to 1.0"):
            calculate_portfolio_returns(returns, np.array([0.5, 0.3]))
    
    def test_empty_returns(self):
        empty = pd.Series(dtype=float)
        
        with pytest.raises(ValueError, match="at least 2"):
            annualized_volatility(empty)


# ============================================================================
# Manual Verification (Sanity Check Values)
# ============================================================================

class TestManualVerification:
    """
    These tests use known inputs with manually calculable expected outputs.
    Run these to get the sanity check values.
    """
    
    def test_sanity_check_values(self):
        """
        Manual verification data:
        
        Returns: [0.01, -0.02, 0.015, -0.01, 0.02, 0.005, -0.015, 0.01, -0.005, 0.01]
        n = 10
        
        Mean = 0.001
        Std = 0.0117
        Annualized vol = 0.0117 * sqrt(252) = 0.1857
        
        95% VaR (historical): 5th percentile of sorted returns
        Sorted: [-0.02, -0.015, -0.01, -0.005, 0.005, 0.01, 0.01, 0.01, 0.015, 0.02]
        5th percentile (index 0): ~0.02
        
        Sharpe (rf=0.02): (0.001*252 - 0.02) / (0.0117*sqrt(252)) = (0.252-0.02)/0.1857 = 1.25
        """
        returns = np.array([0.01, -0.02, 0.015, -0.01, 0.02, 0.005, -0.015, 0.01, -0.005, 0.01])
        
        # Annualized volatility
        vol = annualized_volatility(returns)
        print(f"\nSanity Check - Annualized Volatility: {vol:.4f} (expected ~0.1857)")
        
        # Historical VaR at 95%
        var_95 = historical_var(returns, 0.95)
        print(f"Sanity Check - Historical VaR 95%: {var_95:.4f} (expected ~0.02)")
        
        # Parametric VaR
        param_var = parametric_var(returns, 0.95)
        print(f"Sanity Check - Parametric VaR 95%: {param_var:.4f}")
        
        # Sharpe ratio
        sharpe = sharpe_ratio(returns, risk_free_rate=0.02)
        print(f"Sanity Check - Sharpe Ratio: {sharpe:.4f} (expected ~1.25)")
        
        # Max drawdown
        mdd = max_drawdown(returns)
        print(f"Sanity Check - Max Drawdown: {mdd:.4f}")
        
        # These are assertions to document expected values
        assert np.isclose(vol, 0.1857, atol=0.05)
        assert np.isclose(var_95, 0.02, atol=0.01)
        assert sharpe > 0.5


# ============================================================================
# Monte Carlo Tests
# ============================================================================

class TestMonteCarlo:
    """Tests for Monte Carlo simulation functions."""
    
    def test_simulate_gbm_paths_shape(self):
        """Test that GBM paths have correct shape."""
        paths = simulate_gbm_paths(
            current_price=100.0,
            mu=0.10,
            sigma=0.20,
            days=252,
            num_simulations=1000
        )
        
        # Shape should be (num_simulations, days + 1) for initial price + each day
        assert paths.shape == (1000, 253)
        
        # First column should be current_price
        assert np.allclose(paths[:, 0], 100.0)
    
    def test_simulate_gbm_paths_sigma_zero(self):
        """Test that with sigma=0, all paths are identical (deterministic growth)."""
        paths = simulate_gbm_paths(
            current_price=100.0,
            mu=0.10,
            sigma=0.0,  # No volatility
            days=252,
            num_simulations=100
        )
        
        # All paths should be nearly identical
        std_across_paths = np.std(paths, axis=0)
        # Allow tiny numerical differences
        assert np.all(std_across_paths < 1e-10)
        
        # Expected final price with deterministic growth
        expected_final = 100.0 * np.exp(0.10)
        assert np.isclose(paths[0, -1], expected_final, rtol=1e-4)
    
    def test_simulate_gbm_paths_positive_prices(self):
        """Test that all simulated prices are positive."""
        paths = simulate_gbm_paths(
            current_price=100.0,
            mu=0.10,
            sigma=0.20,
            days=252,
            num_simulations=500
        )
        
        # All prices should be positive
        assert np.all(paths > 0)
    
    def test_monte_carlo_var_basic(self):
        """Test Monte Carlo VaR calculation."""
        np.random.seed(42)
        current_value = 100000.0
        # Simulate final values with 10% mean return, 20% vol
        final_values = current_value * np.exp(np.random.normal(0.10, 0.20, 10000))
        
        var_95 = monte_carlo_var(final_values, current_value, 0.95)
        
        # VaR should be positive
        assert var_95 > 0
        # VaR should be less than current value (can't lose more than 100%)
        assert var_95 < current_value
    
    def test_monte_carlo_cvar_ge_var(self):
        """Test that CVaR >= VaR (by definition, CVaR is worse than VaR)."""
        np.random.seed(42)
        current_value = 100000.0
        final_values = current_value * np.exp(np.random.normal(0.10, 0.20, 10000))
        
        var_95 = monte_carlo_var(final_values, current_value, 0.95)
        cvar_95 = monte_carlo_cvar(final_values, current_value, 0.95)
        
        # CVaR should always be >= VaR
        assert cvar_95 >= var_95
    
    def test_monte_carlo_summary(self):
        """Test Monte Carlo summary statistics."""
        np.random.seed(42)
        current_value = 100000.0
        final_values = current_value * np.exp(np.random.normal(0.10, 0.20, 10000))
        
        summary = monte_carlo_summary(final_values, current_value, 0.95)
        
        # Check all expected keys exist
        expected_keys = [
            "mean_final_value", "median_final_value", "std_final_value",
            "var", "cvar", "var_pct", "cvar_pct",
            "percentiles", "return_percentiles",
            "prob_loss", "prob_gain"
        ]
        for key in expected_keys:
            assert key in summary
        
        # Check percentile keys
        assert set(summary["percentiles"].keys()) == {"p5", "p25", "p50", "p75", "p95"}
        assert set(summary["return_percentiles"].keys()) == {"p5", "p25", "p50", "p75", "p95"}
        
        # Probabilities should be between 0 and 1
        assert 0 <= summary["prob_loss"] <= 1
        assert 0 <= summary["prob_gain"] <= 1
        assert np.isclose(summary["prob_loss"] + summary["prob_gain"], 1.0, atol=0.01)
    
    def test_simulate_portfolio_paths_correlation(self):
        """Test that portfolio simulation respects correlation matrix."""
        np.random.seed(42)
        
        # Two assets with high correlation
        corr_matrix = np.array([[1.0, 0.9], [0.9, 1.0]])
        
        holdings_data = [
            {
                'symbol': 'A', 'weight': 0.5, 'mu': 0.10, 'sigma': 0.20,
                'current_price': 100.0, 'quantity': 10
            },
            {
                'symbol': 'B', 'weight': 0.5, 'mu': 0.10, 'sigma': 0.20,
                'current_price': 50.0, 'quantity': 20
            }
        ]
        
        portfolio_paths, asset_paths = simulate_portfolio_paths(
            holdings_data=holdings_data,
            correlation_matrix=corr_matrix,
            days=63,  # ~3 months
            num_simulations=2000
        )
        
        # Check shapes
        assert portfolio_paths.shape == (2000, 64)  # 63 days + initial
        assert asset_paths.shape == (2000, 64, 2)
        
        # Calculate correlation of returns between the two assets
        # Use daily returns from paths
        returns_a = (asset_paths[:, 1:, 0] - asset_paths[:, :-1, 0]) / asset_paths[:, :-1, 0]
        returns_b = (asset_paths[:, 1:, 1] - asset_paths[:, :-1, 1]) / asset_paths[:, :-1, 1]
        
        # Average correlation across simulations
        sim_correlations = [np.corrcoef(returns_a[i], returns_b[i])[0, 1] for i in range(2000)]
        avg_corr = np.mean(sim_correlations)
        
        # Should be close to 0.9
        assert np.isclose(avg_corr, 0.9, atol=0.05)
    
    def test_simulate_portfolio_paths_independent(self):
        """Test that with zero correlation, assets are independent."""
        np.random.seed(42)
        
        # Two assets with zero correlation
        corr_matrix = np.array([[1.0, 0.0], [0.0, 1.0]])
        
        holdings_data = [
            {
                'symbol': 'A', 'weight': 0.5, 'mu': 0.10, 'sigma': 0.20,
                'current_price': 100.0, 'quantity': 10
            },
            {
                'symbol': 'B', 'weight': 0.5, 'mu': 0.10, 'sigma': 0.20,
                'current_price': 50.0, 'quantity': 20
            }
        ]
        
        portfolio_paths, asset_paths = simulate_portfolio_paths(
            holdings_data=holdings_data,
            correlation_matrix=corr_matrix,
            days=63,
            num_simulations=2000
        )
        
        returns_a = (asset_paths[:, 1:, 0] - asset_paths[:, :-1, 0]) / asset_paths[:, :-1, 0]
        returns_b = (asset_paths[:, 1:, 1] - asset_paths[:, :-1, 1]) / asset_paths[:, :-1, 1]
        
        sim_correlations = [np.corrcoef(returns_a[i], returns_b[i])[0, 1] for i in range(2000)]
        avg_corr = np.mean(sim_correlations)
        
        # Should be close to 0
        assert np.isclose(avg_corr, 0.0, atol=0.05)
    
    def test_monte_carlo_var_known_distribution(self):
        """Test MC VaR with known distribution."""
        # Create final values that follow a known distribution
        np.random.seed(123)
        current_value = 1000.0
        # Normal distribution with mean=0.1, std=0.2
        final_values = current_value * np.exp(np.random.normal(0.10, 0.20, 50000))
        
        var_95 = monte_carlo_var(final_values, current_value, 0.95)
        
        # For lognormal with these params, theoretical 95% VaR:
        # mean of log returns = 0.1 - 0.5*0.2^2 = 0.08
        # std of log returns = 0.2
        # 5th percentile of lognormal = exp(0.08 + 0.2 * -1.645) = exp(-0.249) = 0.779
        # VaR = 1000 * (1 - 0.779) = 221
        # Our simulation should be close
        assert 180 < var_95 < 270  # Within reasonable range


# ============================================================================
# Run with: pytest tests/test_risk_engine.py -v --tb=short
# ============================================================================