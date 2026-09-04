'use client';

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { formatCurrency, formatPercent, formatDate, formatNumber, cn } from '@/lib/utils';
import { usePortfolio, useHoldings, usePortfolioValue, useRiskMetrics, useMonteCarlo, useAddHolding, useDeleteHolding, useIngestBatch, useRiskScore, useScenario, useShares } from '@/hooks/useApi';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { MetricCard } from '@/components/MetricCard';
import { HoldingsTable } from '@/components/HoldingsTable';
import { CorrelationHeatmap } from '@/components/CorrelationHeatmap';
import { MonteCarloChart } from '@/components/MonteCarloChart';
import { AddHoldingForm } from '@/components/AddHoldingForm';
import { RiskScore } from '@/components/RiskScore';
import { RiskMatrix } from '@/components/RiskMatrix';
import { ScenarioLab } from '@/components/ScenarioLab';
import { MonteCarloControls } from '@/components/MonteCarloControls';
import { ShareModal } from '@/components/ShareModal';
import { useForm } from 'react-hook-form';
import type { Portfolio, PermissionLevel } from '@/types/api';
import { LiquidGlassModal } from '@/components/ui/LiquidGlass';

interface MonteCarloFormData {
  lookback_days: number;
  num_simulations: number;
  horizon_days: number;
  confidence_level: number;
}

// Exact backend messages for "holdings exist but no PriceHistory rows"
// (see RiskCalculator.calculate_portfolio_risk). Only these messages
// trigger the empty-data state — every other error keeps the red
// Retry panels so genuine failures are never hidden.
const NO_PRICE_DATA_MESSAGES = [
  'no price data available in database',
  'no price data available for holdings',
];

function isNoPriceDataError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return NO_PRICE_DATA_MESSAGES.some((known) => message.includes(known));
}

function NoMarketDataEmptyState({
  title,
  onFetch,
  isFetching,
  fetchError,
  canFetch,
}: {
  title: string;
  onFetch: () => void;
  isFetching: boolean;
  fetchError: string | null;
  canFetch: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card p-6 text-center">
      <p className="font-medium mb-2">{title}</p>
      <p className="text-sm text-muted-foreground mb-4">
        This portfolio has holdings but no market price data yet. Fetch the last two
        years of prices to unlock Sentinel, correlation, and valuation.
      </p>
      {canFetch ? (
        <Button variant="outline" onClick={onFetch} disabled={isFetching}>
          {isFetching ? 'Fetching price data...' : 'Fetch Price Data'}
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">Ask the portfolio owner to fetch price data.</p>
      )}
      {fetchError && (
        <p className="text-sm text-red-400 mt-3">{fetchError}</p>
      )}
    </div>
  );
}

export default function PortfolioDashboardPage() {
  const params = useParams();
  const router = useRouter();
  const portfolioId = parseInt(params.id as string, 10);

  const { data: portfolio, isLoading: portfolioLoading, error: portfolioError } = usePortfolio(portfolioId);
  const { data: holdings, isLoading: holdingsLoading, refetch: refetchHoldings } = useHoldings(portfolioId);
  const { data: portfolioValue, isLoading: valueLoading } = usePortfolioValue(portfolioId);
  const { data: riskMetrics, isLoading: metricsLoading, error: riskMetricsError, refetch: refetchRiskMetrics } = useRiskMetrics(portfolioId, 60, 0.95);
  const { data: riskScore } = useRiskScore(portfolioId, 252, 0.95);
  const scenario = useScenario();
  
  const addHolding = useAddHolding();
  const deleteHolding = useDeleteHolding();
  const runMonteCarlo = useMonteCarlo();
  const ingestBatch = useIngestBatch();

  // Share modal state
  const [showShareModal, setShowShareModal] = useState(false);
  const { data: shares } = useShares(portfolioId);

  const [showAddHolding, setShowAddHolding] = useState(false);
  const [showMonteCarlo, setShowMonteCarlo] = useState(false);
  const [monteCarloParams, setMonteCarloParams] = useState<MonteCarloFormData>({
    lookback_days: 60,
    num_simulations: 5000,
    horizon_days: 252,
    confidence_level: 0.95,
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<MonteCarloFormData>({
    defaultValues: monteCarloParams,
  });

  // Check permissions
  const isOwner = portfolio?.is_owner === true;
  const userPermission: PermissionLevel | undefined = portfolio?.permission;
  const canEdit = isOwner || userPermission === 'edit';
  const canView = isOwner || userPermission === 'view' || userPermission === 'edit';

  if (portfolioLoading) {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading portfolio...</div>
      </div>
    );
  }

  if (portfolioError || !portfolio) {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center">
        <div className="text-center">
          <p className="text-destructive mb-4">Portfolio not found</p>
          <Button onClick={() => router.push('/')}>Back to Portfolios</Button>
        </div>
      </div>
    );
  }

  // Check if user has any access (should not happen due to middleware, but safety)
  if (!canView) {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center">
        <div className="text-center">
          <p className="text-destructive mb-4">Access Denied</p>
          <p className="text-sm text-muted-foreground">You don't have permission to view this portfolio.</p>
          <Button onClick={() => router.push('/')}>Back to Portfolios</Button>
        </div>
      </div>
    );
  }

  const totalValue = parseFloat(portfolioValue?.total_value || '0') || 0;

  // Single source of truth for the holdings list: useHoldings (the portfolio's actual holdings).
  // Enrich with market data from portfolioValue by symbol — holdings without ingested
  // price data still appear (with $0 market values) instead of being silently dropped.
  const marketDataBySymbol = new Map((portfolioValue?.holdings ?? []).map((h) => [h.symbol, h]));

  const holdingsForTable = (holdings ?? []).map((h) => {
    const market = marketDataBySymbol.get(h.symbol);
    return {
      symbol: h.symbol,
      quantity: parseFloat(h.quantity) || 0,
      avg_cost: parseFloat(h.avg_cost) || 0,
      current_price: market?.current_price ?? 0,
      market_value: market?.market_value ?? 0,
      cost_basis: market?.cost_basis ?? 0,
      pnl: market?.pnl ?? 0,
      pnl_pct: market?.pnl_pct ?? 0,
    };
  });

  // Build risk matrix data from risk metrics
  const riskMatrixData = riskMetrics?.holdings_var_contribution?.map((h) => ({
    symbol: h.symbol,
    volatility: h.marginal_var || 0, // Using marginal_var as proxy for volatility contribution
    component_var: h.var_contribution || 0,
    weight: h.weight || 0,
  })) || [];

  const handleAddHolding = async (data: { symbol: string; quantity: string; avg_cost: string }) => {
    await addHolding.mutateAsync({
      portfolioId,
      data: {
        symbol: data.symbol.toUpperCase(),
        quantity: parseFloat(data.quantity),
        avg_cost: parseFloat(data.avg_cost),
      },
    });
  };

  const handleDeleteHolding = async (symbol: string) => {
    if (confirm(`Delete ${symbol} from portfolio?`)) {
      await deleteHolding.mutateAsync({ portfolioId, symbol });
      refetchHoldings();
    }
  };

  const handleFetchPrices = async () => {
    const symbols = holdingsForTable.map((h) => h.symbol);
    const today = new Date();
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    await ingestBatch.mutateAsync({
      symbols,
      start_date: twoYearsAgo.toISOString().split('T')[0],
      end_date: today.toISOString().split('T')[0],
    });
  };

  // Legitimate empty state: holdings exist but no PriceHistory rows yet.
  // Genuine API/network failures fall through to the red Retry panels.
  const showNoMarketDataState =
    !metricsLoading && !riskMetrics && isNoPriceDataError(riskMetricsError);
  const ingestErrorMessage =
    ingestBatch.error instanceof Error ? ingestBatch.error.message : null;

  const handleRunMonteCarlo = async (data: MonteCarloFormData) => {
    await runMonteCarlo.mutateAsync({
      portfolio_id: portfolioId,
      lookback_days: data.lookback_days,
      num_simulations: data.num_simulations,
      horizon_days: data.horizon_days,
      confidence_level: data.confidence_level,
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto p-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-bold tracking-tight">{portfolio.name}</h1>
              {!isOwner && (
                <Badge variant={userPermission === 'edit' ? 'default' : 'outline'}>
                  {userPermission === 'edit' ? 'Can edit' : 'View only'}
                </Badge>
              )}
              {portfolio.owner_email && !isOwner && (
                <span className="text-sm text-muted-foreground">Shared by {portfolio.owner_email}</span>
              )}
            </div>
            <p className="text-muted-foreground mt-1">
              Portfolio ID: {portfolio.id} • Created {formatDate(portfolio.created_at)}
            </p>
          </div>
          <div className="flex gap-2">
            {isOwner && (
              <Button variant="outline" onClick={() => setShowShareModal(true)}>
                Share
              </Button>
            )}
            {canEdit && (
              <Button variant="outline" onClick={() => setShowAddHolding(true)} disabled={addHolding.isPending}>
                + Add Holding
              </Button>
            )}
            <Button onClick={() => setShowMonteCarlo(true)} disabled={runMonteCarlo.isPending}>
              Run Monte Carlo
            </Button>
          </div>
        </div>

        {/* Loading Overlay */}
        {(addHolding.isPending || deleteHolding.isPending || runMonteCarlo.isPending) && (
          <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
            <div className="bg-card p-6 rounded-lg border shadow-lg">
              <div className="flex items-center gap-3">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                <span>Processing...</span>
              </div>
            </div>
          </div>
        )}

        {/* Portfolio Summary Metrics */}
        {portfolioValue && !valueLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <MetricCard
              title="Total Value"
              value={parseFloat(portfolioValue.total_value)}
              format="currency"
            />
            <MetricCard
              title="Total Cost"
              value={parseFloat(portfolioValue.total_cost)}
              format="currency"
            />
            <MetricCard
              title="Total P&L"
              value={parseFloat(portfolioValue.total_pnl)}
              format="currency"
              trend={parseFloat(portfolioValue.total_pnl) >= 0 ? 'up' : 'down'}
            />
            <MetricCard
              title="Total P&L %"
              value={parseFloat(portfolioValue.total_pnl_pct)}
              format="percent"
              trend={parseFloat(portfolioValue.total_pnl_pct) >= 0 ? 'up' : 'down'}
            />
          </div>
        )}

        {/* Sentinel */}
        {riskMetrics && !metricsLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
            <MetricCard
              title="Annualized Volatility"
              value={parseFloat(riskMetrics.portfolio_volatility) * 100}
              format="percent"
              decimals={2}
            />
            <MetricCard
              title="Historical VaR (95%)"
              value={parseFloat(riskMetrics.var_95) * 100}
              format="percent"
              trend="down"
              decimals={2}
            />
            <MetricCard
              title="Parametric VaR (95%)"
              value={parseFloat(riskMetrics.cvar_95) * 100}
              format="percent"
              trend="down"
              decimals={2}
            />
            <MetricCard
              title="Max Drawdown"
              value={parseFloat(riskMetrics.max_drawdown) * 100}
              format="percent"
              trend="down"
              decimals={2}
            />
            <MetricCard
              title="Sharpe Ratio"
              value={parseFloat(riskMetrics.sharpe_ratio || '0')}
              format="number"
              decimals={2}
              trend={parseFloat(riskMetrics.sharpe_ratio || '0') > 1 ? 'up' : 'neutral'}
            />
          </div>
        )}

        {/* Risk Score */}
        {riskScore && (
          <div className="mb-8">
            <RiskScore
              score={riskScore.risk_score}
              label={riskScore.risk_label}
              varComponent={riskScore.var_component}
              sharpeComponent={riskScore.sharpe_component}
              correlationComponent={riskScore.correlation_component}
            />
          </div>
        )}

        {/* Risk Matrix + Scenario Lab */}
        <div className="grid gap-6 lg:grid-cols-2 mb-8">
          <div>
            {showNoMarketDataState ? (
              <NoMarketDataEmptyState
                title="No market data yet"
                onFetch={handleFetchPrices}
                isFetching={ingestBatch.isPending}
                fetchError={ingestErrorMessage}
                canFetch={canEdit}
              />
            ) : (
              <RiskMatrix
                data={riskMatrixData}
                isLoading={metricsLoading || ingestBatch.isPending}
                error={metricsLoading ? undefined : (!riskMetrics && !metricsLoading ? "Failed to load risk matrix" : undefined)}
                onRetry={refetchRiskMetrics}
              />
            )}
          </div>
          <div>
            <ScenarioLab
              portfolioId={portfolioId}
              portfolioName={portfolio.name}
              currentValue={totalValue}
              currentVar95={parseFloat(riskMetrics?.var_95 || '0')}
              currentVolatility={parseFloat(riskMetrics?.portfolio_volatility || '0')}
            />
          </div>
        </div>

        {/* Monte Carlo Controls */}
        <div className="mb-8">
          <MonteCarloControls
            portfolioId={portfolioId}
            currentValue={totalValue}
            currentVar95={parseFloat(riskMetrics?.var_95 || '0')}
            onRun={async (params) => {
              await runMonteCarlo.mutateAsync({
                portfolio_id: portfolioId,
                lookback_days: params.lookback_days,
                num_simulations: params.num_simulations,
                horizon_days: params.horizon_days,
                confidence_level: params.confidence_level,
              });
            }}
            isRunning={runMonteCarlo.isPending}
            defaultParams={monteCarloParams}
          />
        </div>

<div className="grid gap-6 lg:grid-cols-2 lg:grid-cols-[1fr_1.5fr]">
          {/* Holdings Section */}
          <div className="lg:col-span-1">
            <Card>
<CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>Holdings</CardTitle>
                    <CardDescription>{holdingsForTable.length} positions {canEdit ? null : <Badge variant="outline" className="ml-2">View only</Badge>}</CardDescription>
                  </div>
                  <div>
                    {canEdit && (
                      <Button
                        variant="outline"
                        onClick={handleFetchPrices}
                        disabled={ingestBatch.isPending}
                      >
                        {ingestBatch.isPending ? 'Fetching...' : 'Fetch Price Data'}
                      </Button>
                    )}
                  </div>
                </CardHeader>
              <CardContent>
                <HoldingsTable
                  holdings={holdingsForTable}
                  totalValue={totalValue}
                  onDelete={canEdit ? handleDeleteHolding : undefined}
                  onRetry={refetchHoldings}
                  isLoading={holdingsLoading || valueLoading}
                  error={holdingsLoading || valueLoading ? undefined : (!holdings && !holdingsLoading ? "Failed to load holdings" : undefined)}
                  lastUpdated={portfolioValue?.as_of_date || null}
                  readOnly={!canEdit}
                />
              </CardContent>
            </Card>
          </div>

          {/* Right Side: Correlation + Monte Carlo */}
          <div className="space-y-6">
            {/* Correlation Heatmap */}
            <Card>
              <CardHeader>
                <CardTitle>Correlation Matrix</CardTitle>
                <CardDescription>Pearson correlation of daily returns</CardDescription>
              </CardHeader>
              <CardContent>
                {showNoMarketDataState ? (
                  <NoMarketDataEmptyState
                    title="No correlation data yet"
                    onFetch={handleFetchPrices}
                    isFetching={ingestBatch.isPending}
                    fetchError={ingestErrorMessage}
                    canFetch={canEdit}
                  />
                ) : (
                  <CorrelationHeatmap
                    correlationMatrix={riskMetrics?.correlation_matrix ?? null}
                    symbols={holdingsForTable.map(h => h.symbol)}
                    isLoading={metricsLoading || ingestBatch.isPending}
                    error={metricsLoading ? undefined : (!riskMetrics && !metricsLoading ? "Failed to load Sentinel data" : undefined)}
                    onRetry={refetchRiskMetrics}
                    lastUpdated={riskMetrics?.as_of_date || null}
                  />
                )}
              </CardContent>
            </Card>

            {/* Monte Carlo Section */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Monte Carlo Simulation</CardTitle>
                  <CardDescription>Forward-looking risk analysis</CardDescription>
                </div>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setShowMonteCarlo(true)} 
                  disabled={runMonteCarlo.isPending}
                >
                  Run Simulation
                </Button>
              </CardHeader>
              <CardContent>
                {runMonteCarlo.data && (
                  <MonteCarloChart 
                    data={{
                      simulated_paths_sample: runMonteCarlo.data.simulated_paths_sample,
                      current_value: parseFloat(runMonteCarlo.data.current_value),
                      var: parseFloat(runMonteCarlo.data.var),
                      cvar: parseFloat(runMonteCarlo.data.cvar),
                      mean_final_value: parseFloat(runMonteCarlo.data.mean_final_value),
                      percentiles: {
                        p5: parseFloat(runMonteCarlo.data.percentiles.p5),
                        p25: parseFloat(runMonteCarlo.data.percentiles.p25),
                        p50: parseFloat(runMonteCarlo.data.percentiles.p50),
                        p75: parseFloat(runMonteCarlo.data.percentiles.p75),
                        p95: parseFloat(runMonteCarlo.data.percentiles.p95),
                      },
                      return_percentiles: {
                        p5: parseFloat(runMonteCarlo.data.return_percentiles.p5),
                        p25: parseFloat(runMonteCarlo.data.return_percentiles.p25),
                        p50: parseFloat(runMonteCarlo.data.return_percentiles.p50),
                        p75: parseFloat(runMonteCarlo.data.return_percentiles.p75),
                        p95: parseFloat(runMonteCarlo.data.return_percentiles.p95),
                      },
                      prob_loss: parseFloat(runMonteCarlo.data.prob_loss),
                      prob_gain: parseFloat(runMonteCarlo.data.prob_gain),
                      var_pct: parseFloat(runMonteCarlo.data.var_pct) * 100,
                      cvar_pct: parseFloat(runMonteCarlo.data.cvar_pct) * 100,
                    }}
                    isLoading={runMonteCarlo.isPending}
                    error={runMonteCarlo.error as string | null}
                    onRetry={() => runMonteCarlo.mutateAsync({
                      portfolio_id: portfolioId,
                      lookback_days: monteCarloParams.lookback_days,
                      num_simulations: monteCarloParams.num_simulations,
                      horizon_days: monteCarloParams.horizon_days,
                      confidence_level: monteCarloParams.confidence_level,
                    })}
                    lastUpdated={runMonteCarlo.data?.as_of_date || null}
                  />
                )}
                {!runMonteCarlo.data && (
                  <div className="text-center py-8 text-muted-foreground">
                    <p>No simulation run yet</p>
                    <p className="text-sm">Click "Run Simulation" to generate Monte Carlo analysis</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Modals */}
      <AddHoldingForm
        isOpen={showAddHolding}
        onClose={() => setShowAddHolding(false)}
        onSubmit={handleAddHolding}
        isPending={addHolding.isPending}
      />

      {/* Monte Carlo Modal */}
      <LiquidGlassModal 
        isOpen={showMonteCarlo} 
        onClose={() => setShowMonteCarlo(false)} 
        intensity="medium"
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
      >
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Run Monte Carlo Simulation</h2>
            <button onClick={() => setShowMonteCarlo(false)} className="text-muted-foreground hover:text-foreground" disabled={runMonteCarlo.isPending}>✕</button>
          </div>
          
          <form onSubmit={handleSubmit(handleRunMonteCarlo)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="lookback_days">Lookback Days</Label>
                <Input
                  id="lookback_days"
                  type="number"
                  min="30"
                  max="2520"
                  {...register('lookback_days', { required: 'Required', min: { value: 30, message: 'Min 30 days' } })}
                  defaultValue="60"
                  disabled={runMonteCarlo.isPending}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="num_simulations">Simulations</Label>
                <Input
                  id="num_simulations"
                  type="number"
                  min="100"
                  max="20000"
                  {...register('num_simulations', { required: 'Required', min: { value: 100, message: 'Min 100' } })}
                  defaultValue="5000"
                  disabled={runMonteCarlo.isPending}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="horizon_days">Horizon Days</Label>
                <Input
                  id="horizon_days"
                  type="number"
                  min="1"
                  max="1260"
                  {...register('horizon_days', { required: 'Required', min: { value: 1, message: 'Min 1 day' } })}
                  defaultValue="252"
                  disabled={runMonteCarlo.isPending}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confidence_level">Confidence Level</Label>
                <Input
                  id="confidence_level"
                  type="number"
                  step="0.01"
                  min="0.5"
                  max="0.99"
                  {...register('confidence_level', { required: 'Required', min: { value: 0.5, message: 'Min 0.5' }, max: { value: 0.99, message: 'Max 0.99' } })}
                  defaultValue="0.95"
                  disabled={runMonteCarlo.isPending}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => setShowMonteCarlo(false)} disabled={runMonteCarlo.isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={runMonteCarlo.isPending}>
                {runMonteCarlo.isPending ? 'Running...' : 'Run Simulation'}
              </Button>
            </div>
          </form>
        </div>
      </LiquidGlassModal>

      {/* Share Modal */}
      <ShareModal
        portfolioId={portfolioId}
        portfolioName={portfolio.name}
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        isOwner={isOwner}
      />
    </div>
  );
}