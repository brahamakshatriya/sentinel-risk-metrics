export interface Portfolio {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
  holdings?: Holding[];
  is_owner?: boolean;
  permission?: 'view' | 'edit';
  owner_email?: string;
}

export interface Holding {
  id: number;
  portfolio_id: number;
  symbol: string;
  quantity: string;
  avg_cost: string;
  created_at: string;
  updated_at: string;
  market_value?: number;
  current_price?: number;
  cost_basis?: number;
  pnl?: number;
  pnl_pct?: number;
  weight?: number;
}

export interface PortfolioCreateRequest {
  name: string;
}

export interface HoldingCreateRequest {
  symbol: string;
  quantity: number;
  avg_cost: number;
}

export interface HoldingUpdateRequest {
  quantity?: number;
  avg_cost?: number;
}

export interface PriceHistory {
  id: number;
  symbol: string;
  date: string;
  open: string;
  high: string;
  low: string;
  close: string;
  adjusted_close: string;
  volume: number;
  created_at: string;
}

export interface PriceIngestRequest {
  symbols: string[];
  start_date: string;
  end_date: string;
}

export interface PriceIngestResponse {
  symbol: string;
  records_ingested: number;
  date_range: string;
  skipped: boolean;
  error?: string;
}

export interface PortfolioValueRequest {
  portfolio_id: number;
  as_of_date?: string;
}

export interface PortfolioValueHolding {
  symbol: string;
  quantity: number;
  avg_cost: number;
  current_price: number;
  market_value: number;
  cost_basis: number;
  pnl: number;
  pnl_pct: number;
}

export interface PortfolioValueResponse {
  portfolio_id: number;
  portfolio_name: string;
  as_of_date: string;
  total_value: string;
  total_cost: string;
  total_pnl: string;
  total_pnl_pct: string;
  holdings: PortfolioValueHolding[];
}

export interface RiskMetricsRequest {
  portfolio_id: number;
  lookback_days?: number;
  confidence_level?: number;
}

export interface RiskMetricsResponse {
  portfolio_id: number;
  portfolio_name: string;
  as_of_date: string;
  lookback_days: number;
  confidence_level: number;
  portfolio_volatility: string;
  var_95: string;
  cvar_95: string;
  max_drawdown: string;
  sharpe_ratio: string | null;
  correlation_matrix?: Record<string, Record<string, number>>;
  holdings_var_contribution: Array<{
    symbol: string;
    weight: number;
    var_contribution: number;
    marginal_var: number;
    risk_budget_pct: number;
  }>;
}

export interface MonteCarloRequest {
  portfolio_id: number;
  lookback_days?: number;
  num_simulations?: number;
  horizon_days?: number;
  confidence_level?: number;
}

export interface MonteCarloResponse {
  portfolio_id: number;
  portfolio_name: string;
  as_of_date: string;
  lookback_days: number;
  num_simulations: number;
  horizon_days: number;
  confidence_level: number;
  current_value: string;
  var: string;
  cvar: string;
  var_pct: string;
  cvar_pct: string;
  mean_final_value: string;
  median_final_value: string;
  percentiles: {
    p5: string;
    p25: string;
    p50: string;
    p75: string;
    p95: string;
  };
  return_percentiles: {
    p5: string;
    p25: string;
    p50: string;
    p75: string;
    p95: string;
  };
  prob_loss: string;
  prob_gain: string;
  simulated_paths_sample: number[][];
}

export interface HealthResponse {
  status: string;
  database: string;
  version: string;
}

export interface ScenarioRequest {
  portfolio_id: number;
  market_drop_pct: number;
  vol_spike_pct: number;
  lookback_days?: number;
  confidence_level?: number;
}

export interface ScenarioResponse {
  portfolio_id: number;
  portfolio_name: string;
  as_of_date: string;
  market_drop_pct: number;
  vol_spike_pct: number;
  current_value: number;
  shocked_value: number;
  value_change: number;
  value_change_pct: number;
  original_var_95: number;
  shocked_var_95: number;
  var_change_pct: number;
  original_volatility: number;
  shocked_volatility: number;
}

export interface RiskScoreResponse {
  portfolio_id: number;
  portfolio_name: string;
  as_of_date: string;
  risk_score: number;
  risk_label: string;
  var_component: number;
  sharpe_component: number;
  correlation_component: number;
}

export interface HoldingRiskPoint {
  symbol: string;
  volatility: number;
  component_var: number;
  weight: number;
}

export interface ApiError {
  detail: string | Array<{
    type: string;
    loc: (string | number)[];
    msg: string;
    input: unknown;
    ctx?: Record<string, unknown>;
  }>;
}

export type PermissionLevel = 'view' | 'edit';

export interface PortfolioShare {
  id: number;
  portfolio_id: number;
  shared_with_user_id: number;
  shared_with_email: string;
  permission: PermissionLevel;
  created_at: string;
  created_by_user_id: number;
}

export interface SharePortfolioRequest {
  email: string;
  permission: PermissionLevel;
}