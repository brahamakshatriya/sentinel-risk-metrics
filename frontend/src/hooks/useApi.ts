import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  portfolioApi,
  ingestApi,
  monteCarloApi,
} from '@/lib/api';
import type {
  PortfolioCreateRequest,
  HoldingCreateRequest,
  HoldingUpdateRequest,
  MonteCarloRequest,
  MonteCarloResponse,
  PriceIngestRequest,
  PriceIngestResponse,
  PortfolioValueResponse,
  RiskMetricsResponse,
} from '@/types/api';

// Portfolio hooks
export function usePortfolios() {
  return useQuery({
    queryKey: ['portfolios'],
    queryFn: portfolioApi.list,
  });
}

export function usePortfolio(id: number | null) {
  return useQuery({
    queryKey: ['portfolio', id],
    queryFn: () => portfolioApi.get(id!),
    enabled: !!id,
  });
}

export function useCreatePortfolio() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: portfolioApi.create,
    onSuccess: () => {
      // Invalidate and refetch the portfolios list
      queryClient.invalidateQueries({ queryKey: ['portfolios'] });
      // Also force a refetch to ensure UI updates immediately
      queryClient.refetchQueries({ queryKey: ['portfolios'] });
    },
  });
}

export function useUpdatePortfolio() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: PortfolioCreateRequest }) => portfolioApi.update(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['portfolio', id] });
      queryClient.invalidateQueries({ queryKey: ['portfolios'] });
    },
  });
}

export function useDeletePortfolio() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: portfolioApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolios'] });
    },
  });
}

// Holdings hooks
export function useHoldings(portfolioId: number | null) {
  return useQuery({
    queryKey: ['holdings', portfolioId],
    queryFn: () => portfolioApi.getHoldings(portfolioId!),
    enabled: !!portfolioId,
  });
}

export function useAddHolding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ portfolioId, data }: { portfolioId: number; data: HoldingCreateRequest }) =>
      portfolioApi.addHolding(portfolioId, data),
    onSuccess: (_, { portfolioId }) => {
      queryClient.invalidateQueries({ queryKey: ['holdings', portfolioId] });
      queryClient.invalidateQueries({ queryKey: ['portfolio', portfolioId] });
      queryClient.invalidateQueries({ queryKey: ['portfolios'] });
      // Force immediate refetch to ensure UI updates (not just marking stale)
      queryClient.refetchQueries({ queryKey: ['holdings', portfolioId] });
      queryClient.refetchQueries({ queryKey: ['portfolio', portfolioId] });
      queryClient.refetchQueries({ queryKey: ['portfolios'] });
    },
  });
}

export function useUpdateHolding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ portfolioId, symbol, data }: { portfolioId: number; symbol: string; data: HoldingUpdateRequest }) =>
      portfolioApi.updateHolding(portfolioId, symbol, data),
    onSuccess: (_, { portfolioId }) => {
      queryClient.invalidateQueries({ queryKey: ['holdings', portfolioId] });
      queryClient.invalidateQueries({ queryKey: ['portfolio', portfolioId] });
      queryClient.invalidateQueries({ queryKey: ['portfolios'] });
    },
  });
}

export function useDeleteHolding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ portfolioId, symbol }: { portfolioId: number; symbol: string }) =>
      portfolioApi.deleteHolding(portfolioId, symbol),
    onSuccess: (_, { portfolioId }) => {
      queryClient.invalidateQueries({ queryKey: ['holdings', portfolioId] });
      queryClient.invalidateQueries({ queryKey: ['portfolio', portfolioId] });
      queryClient.invalidateQueries({ queryKey: ['portfolios'] });
    },
  });
}

// Ingestion hooks
export function useIngestBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      symbols,
      start_date,
      end_date,
    }: {
      symbols: string[];
      start_date: string;
      end_date: string;
    }) => ingestApi.batch({ symbols, start_date, end_date }),
    onSuccess: (_, variables) => {
      variables.symbols.forEach((symbol: string) => {
        queryClient.invalidateQueries({ queryKey: ['holdings', symbol] });
      });
      queryClient.invalidateQueries({ queryKey: ['portfolioValue'] });
      queryClient.invalidateQueries({ queryKey: ['riskMetrics'] });
      queryClient.invalidateQueries({ queryKey: ['portfolios'] });
      queryClient.refetchQueries({ queryKey: ['portfolios'] });
    },
  });
}

export function usePriceHistory(symbol: string | null, startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: ['priceHistory', symbol, startDate, endDate],
    queryFn: () => ingestApi.priceHistory(symbol!, startDate, endDate),
    enabled: !!symbol,
  });
}

export function useLatestPrice(symbol: string | null, asOf?: string) {
  return useQuery({
    queryKey: ['latestPrice', symbol, asOf],
    queryFn: () => ingestApi.latestPrice(symbol!, asOf),
    enabled: !!symbol,
  });
}

export function usePortfolioValue(portfolioId: number | null, asOfDate?: string) {
  return useQuery({
    queryKey: ['portfolioValue', portfolioId, asOfDate],
    queryFn: () => ingestApi.portfolioValue(portfolioId!, asOfDate),
    enabled: !!portfolioId,
  });
}

export function useRiskMetrics(portfolioId: number | null, lookbackDays = 252, confidenceLevel = 0.95) {
  return useQuery({
    queryKey: ['riskMetrics', portfolioId, lookbackDays, confidenceLevel],
    queryFn: () => ingestApi.riskMetrics(portfolioId!, lookbackDays, confidenceLevel),
    enabled: !!portfolioId,
  });
}

// Monte Carlo hooks
export function useMonteCarlo() {
  return useMutation({
    mutationFn: monteCarloApi.run,
  });
}

export function useRunMonteCarlo(portfolioId: number | null) {
  return useMutation({
    mutationFn: (data: MonteCarloRequest) => monteCarloApi.run({ ...data, portfolio_id: portfolioId! }),
  });
}