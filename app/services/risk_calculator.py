import numpy as np
import pandas as pd
from datetime import date, timedelta
from decimal import Decimal
from typing import Dict, List, Optional, Any
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models import Portfolio, Holding, PriceHistory
from app.risk_engine.returns import calculate_daily_returns, calculate_portfolio_returns, align_returns
from app.risk_engine.var import historical_var, parametric_var, expected_shortfall
from app.risk_engine.volatility import annualized_volatility
from app.risk_engine.performance import sharpe_ratio, sortino_ratio, max_drawdown, calmar_ratio
from app.risk_engine.portfolio import (
    correlation_matrix, covariance_matrix,
    portfolio_volatility, component_var, marginal_var, risk_budget
)
from app.risk_engine.monte_carlo import (
    simulate_gbm_paths,
    simulate_portfolio_paths,
    monte_carlo_var,
    monte_carlo_cvar,
    monte_carlo_summary,
)
from app.services.riskfree_service import get_risk_free_rate


class RiskCalculator:
    """Service for calculating portfolio risk metrics using the risk_engine modules."""
    
    def __init__(self, db: Session):
        self.db = db
    
    def get_price_data(
        self,
        symbols: List[str],
        start_date: date,
        end_date: date
    ) -> Dict[str, pd.Series]:
        """
        Fetch price data for multiple symbols and return as dict of price Series.
        
        Args:
            symbols: List of ticker symbols
            start_date: Start date for data
            end_date: End date for data
            
        Returns:
            Dict mapping symbol to price Series (indexed by date)
        """
        prices_dict = {}
        
        for symbol in symbols:
            records = self.db.query(PriceHistory.date, PriceHistory.close).filter(
                PriceHistory.symbol == symbol,
                PriceHistory.date >= start_date,
                PriceHistory.date <= end_date
            ).order_by(PriceHistory.date.asc()).all()
            
            if records:
                dates = [r[0] for r in records]
                closes = [float(r[1]) for r in records]
                prices_dict[symbol] = pd.Series(closes, index=dates, name=symbol)
        
        return prices_dict
    
    def calculate_portfolio_risk(
        self,
        portfolio_id: int,
        lookback_days: int = 252,
        confidence_level: float = 0.95,
        as_of_date: Optional[date] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Calculate comprehensive risk metrics for a portfolio.
        
        Args:
            portfolio_id: ID of the portfolio
            lookback_days: Number of days to look back for historical data
            confidence_level: Confidence level for VaR/ES (e.g., 0.95)
            as_of_date: Reference date (defaults to latest available date in DB)
            
        Returns:
            Dictionary of risk metrics or None if portfolio not found
        """
        # If no as_of_date provided, use the latest available date in price_history
        if as_of_date is None:
            latest_date = self.db.query(func.max(PriceHistory.date)).scalar()
            if latest_date is None:
                return {"error": "No price data available in database"}
            as_of = latest_date
        else:
            as_of = as_of_date
        
        start_date = as_of - timedelta(days=lookback_days + 30)  # Extra buffer
        
        # Get portfolio
        portfolio = self.db.query(Portfolio).filter(Portfolio.id == portfolio_id).first()
        if not portfolio:
            return None
        
        # Get holdings
        holdings = self.db.query(Holding).filter(Holding.portfolio_id == portfolio_id).all()
        if not holdings:
            return {"error": "Portfolio has no holdings"}
        
        symbols = [h.symbol for h in holdings]
        
        # Fetch price data
        prices_dict = self.get_price_data(symbols, start_date, as_of)
        if not prices_dict:
            return {"error": "No price data available for holdings"}
        
        # Calculate returns for each holding
        returns_dict = {}
        for symbol, price_series in prices_dict.items():
            if len(price_series) >= 2:
                returns_dict[symbol] = calculate_daily_returns(price_series)
        
        if not returns_dict:
            return {"error": "Insufficient price data for return calculation"}
        
        # Align returns by date
        aligned_returns = align_returns(returns_dict)
        if aligned_returns.empty:
            return {"error": "No overlapping dates in return series"}
        
        # Get current weights from portfolio value
        portfolio_value = self.get_portfolio_value(portfolio_id, as_of)
        if not portfolio_value or not portfolio_value.get("holdings"):
            return {"error": "Could not calculate portfolio value"}
        
        # Build weights array matching the aligned_returns column order
        weights = []
        holding_map = {h["symbol"]: h for h in portfolio_value["holdings"]}
        total_value = float(portfolio_value["total_value"])
        
        for symbol in aligned_returns.columns:
            if symbol in holding_map:
                weight = holding_map[symbol]["market_value"] / total_value
                weights.append(float(weight))
            else:
                weights.append(0.0)
        
        weights = np.array(weights)
        if np.sum(weights) == 0:
            return {"error": "Could not determine portfolio weights"}
        
        # Normalize weights
        weights = weights / np.sum(weights)
        
        # Calculate portfolio returns
        portfolio_returns = calculate_portfolio_returns(aligned_returns, weights)
        
        # Risk metrics
        vol = annualized_volatility(portfolio_returns)
        hist_var = historical_var(portfolio_returns, confidence_level)
        param_var = parametric_var(portfolio_returns, confidence_level)
        es = expected_shortfall(portfolio_returns, confidence_level)
        max_dd = max_drawdown(portfolio_returns)
        
        # Use live risk-free rate
        rf_rate = get_risk_free_rate(self.db)
        sharpe = sharpe_ratio(portfolio_returns, risk_free_rate=rf_rate)
        sortino = sortino_ratio(portfolio_returns, risk_free_rate=rf_rate)
        calmar = calmar_ratio(portfolio_returns)
        
        # Portfolio-level covariance and component VaR
        cov_matrix = covariance_matrix(aligned_returns)
        port_vol = portfolio_volatility(weights, cov_matrix)
        comp_var = component_var(weights, cov_matrix, port_vol)
        marg_var = marginal_var(weights, cov_matrix, port_vol)
        risk_contrib = risk_budget(weights, cov_matrix)
        
        # Holdings VaR contribution
        holdings_var_contrib = []
        for i, symbol in enumerate(aligned_returns.columns):
            if symbol in holding_map:
                h = holding_map[symbol]
                holdings_var_contrib.append({
                    "symbol": symbol,
                    "weight": float(weights[i]),
                    "var_contribution": float(comp_var[i]),
                    "marginal_var": float(marg_var[i]),
                    "risk_budget_pct": float(risk_contrib.iloc[i]) if hasattr(risk_contrib, 'iloc') else float(risk_contrib[i])
                })
        
        # Correlation matrix
        corr_matrix = correlation_matrix(aligned_returns)
        
        return {
            "portfolio_id": portfolio.id,
            "portfolio_name": portfolio.name,
            "as_of_date": as_of,
            "lookback_days": lookback_days,
            "confidence_level": confidence_level,
            "portfolio_volatility": float(vol),
            "var_historical": float(hist_var),
            "var_parametric": float(param_var),
            "expected_shortfall": float(es),
            "max_drawdown": float(max_dd),
            "sharpe_ratio": float(sharpe) if not np.isnan(sharpe) else None,
            "sortino_ratio": float(sortino) if not np.isnan(sortino) else None,
            "calmar_ratio": float(calmar) if not np.isnan(calmar) else None,
            "holdings_var_contribution": holdings_var_contrib,
            "correlation_matrix": corr_matrix.to_dict(),
            "covariance_matrix": cov_matrix.to_dict(),
            "portfolio_vol_from_cov": float(port_vol),
        }
    
    def get_portfolio_value(self, portfolio_id: int, as_of: date) -> Optional[Dict[str, Any]]:
        """Calculate current portfolio value and holdings detail."""
        holdings = self.db.query(Holding).filter(Holding.portfolio_id == portfolio_id).all()
        if not holdings:
            return None
        
        total_value = Decimal("0")
        total_cost = Decimal("0")
        holdings_detail = []
        
        for holding in holdings:
            price_record = self.db.query(PriceHistory.close).filter(
                PriceHistory.symbol == holding.symbol,
                PriceHistory.date <= as_of
            ).order_by(PriceHistory.date.desc()).first()
            
            if price_record:
                current_price = Decimal(str(price_record[0]))
                market_value = holding.quantity * current_price
                cost_basis = holding.quantity * holding.avg_cost
                pnl = market_value - cost_basis
                pnl_pct = (pnl / cost_basis * 100) if cost_basis > 0 else Decimal("0")
                
                total_value += market_value
                total_cost += cost_basis
                
                holdings_detail.append({
                    "symbol": holding.symbol,
                    "quantity": float(holding.quantity),
                    "avg_cost": float(holding.avg_cost),
                    "current_price": float(current_price),
                    "market_value": float(market_value),
                    "cost_basis": float(cost_basis),
                    "pnl": float(pnl),
                    "pnl_pct": float(pnl_pct)
                })
        
        total_pnl = total_value - total_cost
        total_pnl_pct = (total_pnl / total_cost * 100) if total_cost > 0 else Decimal("0")
        
        return {
            "portfolio_id": portfolio_id,
            "as_of_date": as_of,
            "total_value": total_value,
            "total_cost": total_cost,
            "total_pnl": total_pnl,
            "total_pnl_pct": total_pnl_pct,
            "holdings": holdings_detail
        }

    def run_monte_carlo(
        self,
        portfolio_id: int,
        lookback_days: int = 252,
        num_simulations: int = 5000,
        horizon_days: int = 252,
        confidence_level: float = 0.95,
        as_of_date: Optional[date] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Run Monte Carlo simulation for portfolio forward-looking risk.
        
        Args:
            portfolio_id: ID of the portfolio
            lookback_days: Days of historical data for parameter estimation
            num_simulations: Number of simulation paths (capped at 20000)
            horizon_days: Forecast horizon in trading days
            confidence_level: Confidence level for VaR/CVaR
            as_of_date: Reference date (defaults to latest available)
            
        Returns:
            Dictionary with Monte Carlo results
        """
        # Cap simulations for performance
        num_simulations = min(max(num_simulations, 100), 20000)
        
        # If no as_of_date provided, use the latest available date in price_history
        if as_of_date is None:
            latest_date = self.db.query(func.max(PriceHistory.date)).scalar()
            if latest_date is None:
                return {"error": "No price data available in database"}
            as_of = latest_date
        else:
            as_of = as_of_date
        
        start_date = as_of - timedelta(days=lookback_days + 30)
        
        # Get portfolio
        portfolio = self.db.query(Portfolio).filter(Portfolio.id == portfolio_id).first()
        if not portfolio:
            return None
        
        # Get holdings
        holdings = self.db.query(Holding).filter(Holding.portfolio_id == portfolio_id).all()
        if not holdings:
            return {"error": "Portfolio has no holdings"}
        
        symbols = [h.symbol for h in holdings]
        
        # Fetch price data
        prices_dict = self.get_price_data(symbols, start_date, as_of)
        if not prices_dict:
            return {"error": "No price data available for holdings"}
        
        # Calculate returns for each holding
        returns_dict = {}
        for symbol, price_series in prices_dict.items():
            if len(price_series) >= 2:
                returns_dict[symbol] = calculate_daily_returns(price_series)
        
        if not returns_dict:
            return {"error": "Insufficient price data for return calculation"}
        
        # Align returns by date
        aligned_returns = align_returns(returns_dict)
        if aligned_returns.empty:
            return {"error": "No overlapping dates in return series"}
        
        # Get current weights from portfolio value
        portfolio_value = self.get_portfolio_value(portfolio_id, as_of)
        if not portfolio_value or not portfolio_value.get("holdings"):
            return {"error": "Could not calculate portfolio value"}
        
        # Build weights array
        weights = []
        holding_map = {h["symbol"]: h for h in portfolio_value["holdings"]}
        total_value = float(portfolio_value["total_value"])
        
        for symbol in aligned_returns.columns:
            if symbol in holding_map:
                weight = holding_map[symbol]["market_value"] / total_value
                weights.append(float(weight))
            else:
                weights.append(0.0)
        
        weights = np.array(weights)
        if np.sum(weights) == 0:
            return {"error": "Could not determine portfolio weights"}
        weights = weights / np.sum(weights)
        
        # Get current prices for each holding (as of the reference date)
        current_prices = {}
        for symbol in aligned_returns.columns:
            price_record = self.db.query(PriceHistory.close).filter(
                PriceHistory.symbol == symbol,
                PriceHistory.date <= as_of
            ).order_by(PriceHistory.date.desc()).first()
            if price_record:
                current_prices[symbol] = float(price_record[0])
        
        # Ensure we have prices for all symbols
        for symbol in aligned_returns.columns:
            if symbol not in current_prices:
                # Use avg_cost as fallback
                for h in holdings:
                    if h.symbol == symbol:
                        current_prices[symbol] = float(h.avg_cost)
                        break
        
        # Extract mu (annualized mean return) and sigma (annualized vol) for each holding
        mus = []
        sigmas = []
        for symbol in aligned_returns.columns:
            ret_series = aligned_returns[symbol].dropna()
            if len(ret_series) > 1:
                mu = ret_series.mean() * 252  # annualized
                sigma = ret_series.std(ddof=1) * np.sqrt(252)  # annualized
            else:
                mu = 0.0
                sigma = 0.2  # default 20% vol
            mus.append(mu)
            sigmas.append(sigma)
        
        mus = np.array(mus)
        sigmas = np.array(sigmas)
        
        # Correlation matrix for Cholesky decomposition
        corr_matrix = correlation_matrix(aligned_returns)
        corr_values = corr_matrix.values
        
        # Build holdings map from portfolio_value (it's a list, convert to dict)
        holdings_map = {h["symbol"]: h for h in portfolio_value["holdings"]}
        
        # Build holdings data for simulation
        holdings_data = []
        for i, symbol in enumerate(aligned_returns.columns):
            holdings_data.append({
                'symbol': symbol,
                'weight': float(weights[i]),
                'mu': mus[i],
                'sigma': sigmas[i],
                'current_price': current_prices.get(symbol, 100.0),
                'quantity': float(holdings_map.get(symbol, {}).get("quantity", 1.0))
            })
        
        # Run portfolio simulation
        portfolio_paths, _ = simulate_portfolio_paths(
            holdings_data=holdings_data,
            correlation_matrix=corr_values,
            days=horizon_days,
            num_simulations=num_simulations
        )
        
        # Final values
        final_values = portfolio_paths[:, -1]
        current_portfolio_value = total_value
        
        # Monte Carlo VaR and CVaR
        mc_var = monte_carlo_var(final_values, current_portfolio_value, confidence_level)
        mc_cvar = monte_carlo_cvar(final_values, current_portfolio_value, confidence_level)
        
        # Summary stats
        summary = monte_carlo_summary(final_values, current_portfolio_value, confidence_level)
        
        # Sample paths for frontend (limit to 50 paths)
        sample_size = min(50, num_simulations)
        sample_indices = np.random.choice(num_simulations, sample_size, replace=False)
        sample_paths = portfolio_paths[sample_indices].tolist()
        
        return {
            "portfolio_id": portfolio.id,
            "portfolio_name": portfolio.name,
            "as_of_date": as_of,
            "lookback_days": lookback_days,
            "num_simulations": num_simulations,
            "horizon_days": horizon_days,
            "confidence_level": confidence_level,
            "current_value": current_portfolio_value,
            "var": mc_var,
            "cvar": mc_cvar,
            "var_pct": mc_var / current_portfolio_value if current_portfolio_value > 0 else 0,
            "cvar_pct": mc_cvar / current_portfolio_value if current_portfolio_value > 0 else 0,
            "mean_final_value": summary["mean_final_value"],
            "median_final_value": summary["median_final_value"],
            "percentiles": summary["percentiles"],
            "return_percentiles": summary["return_percentiles"],
            "prob_loss": summary["prob_loss"],
            "prob_gain": summary["prob_gain"],
            "simulated_paths_sample": sample_paths,
        }


def get_risk_calculator(db: Session) -> RiskCalculator:
    """Dependency injection helper for FastAPI."""
    return RiskCalculator(db)