import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import type {
  Portfolio,
  Holding,
  PriceHistory,
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

// Unwrap the axios response so callers receive the actual API payload
const unwrap = <T>(promise: Promise<AxiosResponse<T>>) => promise.then((response) => response.data);

// Portfolio endpoints
export const portfolioApi = {
  list: () => unwrap(api.get<Portfolio[]>('/api/v1/portfolios/')),
  get: (id: number) => unwrap(api.get<Portfolio>(`/api/v1/portfolios/${id}`)),
  create: (data: PortfolioCreateRequest) => unwrap(api.post<Portfolio>('/api/v1/portfolios/', data)),
  update: (id: number, data: PortfolioCreateRequest) => unwrap(api.put<Portfolio>(`/api/v1/portfolios/${id}`, data)),
  delete: (id: number) => unwrap(api.delete(`/api/v1/portfolios/${id}`)),

  // Holdings
  getHoldings: (portfolioId: number) => unwrap(api.get<Holding[]>(`/api/v1/portfolios/${portfolioId}/holdings`)),
  addHolding: (portfolioId: number, data: HoldingCreateRequest) =>
    unwrap(api.post<Holding>(`/api/v1/portfolios/${portfolioId}/holdings`, data)),
  updateHolding: (portfolioId: number, symbol: string, data: HoldingUpdateRequest) =>
    unwrap(api.put<Holding>(`/api/v1/portfolios/${portfolioId}/holdings/${symbol}`, data)),
  deleteHolding: (portfolioId: number, symbol: string) =>
    unwrap(api.delete(`/api/v1/portfolios/${portfolioId}/holdings/${symbol}`)),
};

// Ingestion endpoints
export const ingestApi = {
  single: (symbol: string, startDate: string, endDate: string) =>
    unwrap(api.post<PriceIngestResponse>(`/api/v1/ingest/${symbol}`, null, { params: { start_date: startDate, end_date: endDate } })),
  batch: (data: { symbols: string[]; start_date: string; end_date: string }) =>
    unwrap(api.post<PriceIngestResponse[]>('/api/v1/ingest/batch', data)),
  priceHistory: (symbol: string, startDate?: string, endDate?: string, limit?: number) =>
    unwrap(api.get<PriceHistory[]>(
      `/api/v1/ingest/price-history/${symbol}`,
      { params: { start_date: startDate, end_date: endDate, limit } }
    )),
  latestPrice: (symbol: string, asOf?: string) =>
    unwrap(api.get<PriceHistory>(
      `/api/v1/ingest/price-history/${symbol}/latest`,
      { params: { as_of: asOf } }
    )),
  portfolioValue: (portfolioId: number, asOfDate?: string) =>
    unwrap(api.post<PortfolioValueResponse>('/api/v1/ingest/portfolio-value', { portfolio_id: portfolioId, as_of_date: asOfDate })),
  riskMetrics: (portfolioId: number, lookbackDays: number = 252, confidenceLevel: number = 0.95) =>
    unwrap(api.post<RiskMetricsResponse>('/api/v1/ingest/risk-metrics', {
      portfolio_id: portfolioId,
      lookback_days: lookbackDays,
      confidence_level: confidenceLevel,
    })),
};

// Monte Carlo
export const monteCarloApi = {
  run: (data: MonteCarloRequest) =>
    unwrap(api.post<MonteCarloResponse>(`/api/v1/portfolios/${data.portfolio_id}/monte-carlo`, data)),
};

// Health
export const healthApi = {
  check: () => unwrap(api.get<{ status: string; database: string; version: string }>('/health')),
};

export default api;