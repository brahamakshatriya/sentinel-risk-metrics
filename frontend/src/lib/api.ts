import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import type {
  Portfolio,
  Holding,
  PortfolioValueResponse,
  RiskMetricsResponse,
  MonteCarloRequest,
  MonteCarloResponse,
  PriceIngestRequest,
  PriceIngestResponse,
  PortfolioCreateRequest,
  HoldingCreateRequest,
  HoldingUpdateRequest,
  ApiError,
} from '@/types/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL;
if (!API_URL) {
  throw new Error('NEXT_PUBLIC_API_URL environment variable is required');
}

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

// Request interceptor for logging
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[API] ${config.method?.toUpperCase()} ${config.url}`);
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiError>) => {
    const message = error.response?.data?.detail;
    if (Array.isArray(message)) {
      return Promise.reject(new Error(message.map((m) => m.msg).join(', ')));
    }
    return Promise.reject(new Error(message || error.message));
  }
);

// Portfolio endpoints
export const portfolioApi = {
  list: () => api.get<Portfolio[]>('/api/v1/portfolios/'),
  get: (id: number) => api.get<Portfolio>(`/api/v1/portfolios/${id}`),
  create: (data: PortfolioCreateRequest) => api.post<Portfolio>('/api/v1/portfolios/', data),
  update: (id: number, data: PortfolioCreateRequest) => api.put<Portfolio>(`/api/v1/portfolios/${id}`, data),
  delete: (id: number) => api.delete(`/api/v1/portfolios/${id}`),

  // Holdings
  getHoldings: (portfolioId: number) => api.get<Holding[]>(`/api/v1/portfolios/${portfolioId}/holdings`),
  addHolding: (portfolioId: number, data: HoldingCreateRequest) =>
    api.post<Holding>(`/api/v1/portfolios/${portfolioId}/holdings`, data),
  updateHolding: (portfolioId: number, symbol: string, data: HoldingUpdateRequest) =>
    api.put<Holding>(`/api/v1/portfolios/${portfolioId}/holdings/${symbol}`, data),
  deleteHolding: (portfolioId: number, symbol: string) =>
    api.delete(`/api/v1/portfolios/${portfolioId}/holdings/${symbol}`),
};

// Ingestion endpoints
export const ingestApi = {
  single: (symbol: string, startDate: string, endDate: string) =>
    api.post<PriceIngestResponse>(`/api/v1/ingest/${symbol}`, null, { params: { start_date: startDate, end_date: endDate } }),
  batch: (data: { symbols: string[]; start_date: string; end_date: string }) =>
    api.post<PriceIngestResponse[]>('/api/v1/ingest/batch', data),
  priceHistory: (symbol: string, startDate?: string, endDate?: string, limit?: number) =>
    api.get<Array<{ symbol: string; date: string; open: string; high: string; low: string; close: string; adjusted_close: string; volume: number; id: number; created_at: string }>>(
      `/api/v1/ingest/price-history/${symbol}`,
      { params: { start_date: startDate, end_date: endDate, limit } }
    ),
  latestPrice: (symbol: string, asOf?: string) =>
    api.get<{ symbol: string; date: string; open: string; high: string; low: string; close: string; adjusted_close: string; volume: number; id: number; created_at: string }>(
      `/api/v1/ingest/price-history/${symbol}/latest`,
      { params: { as_of: asOf } }
    ),
  portfolioValue: (portfolioId: number, asOfDate?: string) =>
    api.post<{
      portfolio_id: number;
      portfolio_name: string;
      as_of_date: string;
      total_value: string;
      total_cost: string;
      total_pnl: string;
      total_pnl_pct: string;
      holdings: Array<{
        symbol: string;
        quantity: number;
        avg_cost: number;
        current_price: number;
        market_value: number;
        cost_basis: number;
        pnl: number;
        pnl_pct: number;
      }>;
    }>('/api/v1/ingest/portfolio-value', { portfolio_id: portfolioId, as_of_date: asOfDate }),
  riskMetrics: (portfolioId: number, lookbackDays: number = 252, confidenceLevel: number = 0.95) =>
    api.post<{
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
      holdings_var_contribution: Array<{
        symbol: string;
        weight: number;
        var_contribution: number;
        marginal_var: number;
        risk_budget_pct: number;
      }>;
    }>('/api/v1/ingest/risk-metrics', {
      portfolio_id: portfolioId,
      lookback_days: lookbackDays,
      confidence_level: confidenceLevel,
    }),
};

// Monte Carlo
export const monteCarloApi = {
  run: (data: MonteCarloRequest) =>
    api.post<MonteCarloResponse>(`/api/v1/portfolios/${data.portfolio_id}/monte-carlo`, data),
};

// Health
export const healthApi = {
  check: () => api.get<{ status: string; database: string; version: string }>('/health'),
};

export default api;