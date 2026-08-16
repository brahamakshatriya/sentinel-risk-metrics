'use client';

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { formatCurrency, formatPercent, formatDate, formatNumber, cn } from '@/lib/utils';
import { usePortfolio, useHoldings, usePortfolioValue, useRiskMetrics, useMonteCarlo, useAddHolding, useDeleteHolding } from '@/hooks/useApi';
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
import { useForm } from 'react-hook-form';

interface MonteCarloFormData {
  lookback_days: number;
  num_simulations: number;
  horizon_days: number;
  confidence_level: number;
}

export default function PortfolioDashboardPage() {
  const params = useParams();
  const router = useRouter();
  const portfolioId = parseInt(params.id as string, 10);

  const { data: portfolio, isLoading: portfolioLoading, error: portfolioError } = usePortfolio(portfolioId);
  const { data: holdings, isLoading: holdingsLoading, refetch: refetchHoldings } = useHoldings(portfolioId);
  const { data: portfolioValue, isLoading: valueLoading } = usePortfolioValue(portfolioId);
  const { data: riskMetrics, isLoading: metricsLoading } = useRiskMetrics(portfolioId, 60, 0.95);
  
  const addHolding = useAddHolding();
  const deleteHolding = useDeleteHolding();
  const runMonteCarlo = useMonteCarlo();

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
    reset,
    formState: { errors },
  } = useForm<{ symbol: string; quantity: string; avg_cost: string }>({
    defaultValues: { symbol: '', quantity: '', avg_cost: '' },
  });

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

  const totalValue = portfolioValue?.total_value ? parseFloat(portfolioValue.total_value) : 0;
  
  // Convert holdings to format expected by HoldingsTable
  const holdingsForTable = portfolioValue?.holdings?.map(h => ({
    symbol: h.symbol,
    quantity: h.quantity.toString(),
    avg_cost: h.avg_cost.toString(),
    current_price: h.current_price,
    market_value: h.market_value,
    cost_basis: h.cost_basis,
    pnl: h.pnl,
    pnl_pct: h.pnl_pct,
    weight: totalValue > 0 ? h.market_value / totalValue : 0,
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

  const handleRunMonteCarlo = async (data: MonteCarloFormData) => {
    await runMonteCarlo.mutateAsync({
      portfolio_id: portfolioId,
      lookback_days: data.lookback_days,
      num_simulations: data.num_simulations,
      horizon_days: data.horizon_days,
      confidence_level: data.confidence_level,
    });
  };

  if (portfolioLoading) {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading portfolio...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto p-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{portfolio.name}</h1>
            <p className="text-muted-foreground mt-1">
              Portfolio ID: {portfolio.id} • Created {formatDate(portfolio.created_at)}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowAddHolding(true)} disabled={addHolding.isPending}>
              + Add Holding
            </Button>
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

        <div className="grid gap-6 lg:grid-cols-2 lg:grid-cols-[1fr_1.5fr]">
          {/* Holdings Section */}
          <div className="lg:col-span-1">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Holdings</CardTitle>
                  <CardDescription>{holdings?.length || 0} positions</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => setShowAddHolding(true)} disabled={addHolding.isPending}>
                  + Add
                </Button>
              </CardHeader>
              <CardContent>
                <HoldingsTable
                  holdings={holdingsForTable}
                  totalValue={totalValue}
                  onDelete={handleDeleteHolding}
                  isLoading={holdingsLoading || valueLoading}
                  error={holdingsLoading || valueLoading ? undefined : (!portfolioValue && !holdingsLoading && !valueLoading ? "Failed to load portfolio value" : undefined)}
                  lastUpdated={portfolioValue?.as_of_date || null}
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
                <CorrelationHeatmap
                  correlationMatrix={riskMetrics?.correlation_matrix || null}
                  symbols={holdingsForTable.map(h => h.symbol)}
                  isLoading={metricsLoading}
                  error={metricsLoading ? undefined : (!riskMetrics && !metricsLoading ? "Failed to load Sentinel data" : undefined)}
                  lastUpdated={riskMetrics?.as_of_date || null}
                />
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
                      percentiles: runMonteCarlo.data.percentiles,
                      return_percentiles: runMonteCarlo.data.return_percentiles,
                      prob_loss: parseFloat(runMonteCarlo.data.prob_loss),
                      prob_gain: parseFloat(runMonteCarlo.data.prob_gain),
                      current_value: parseFloat(runMonteCarlo.data.current_value),
                      var: parseFloat(runMonteCarlo.data.var),
                      cvar: parseFloat(runMonteCarlo.data.cvar),
                      var_pct: parseFloat(runMonteCarlo.data.var_pct) * 100,
                      cvar_pct: parseFloat(runMonteCarlo.data.cvar_pct) * 100,
                    }}
                    isLoading={runMonteCarlo.isPending}
                    error={runMonteCarlo.isPending ? undefined : (!runMonteCarlo.data && !runMonteCarlo.isPending ? "No simulation data available" : undefined)}
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
      {showAddHolding && (
        <AddHoldingForm
          onSubmit={handleAddHolding}
          isPending={addHolding.isPending}
        />
      )}

      {showMonteCarlo && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg border bg-card p-6 shadow-lg">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Run Monte Carlo Simulation</h2>
              <button onClick={() => setShowMonteCarlo(false)} className="text-muted-foreground hover:text-foreground">✕</button>
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
                    {...register('confidence_level', { required: 'Required', min: { value: 0.5 }, max: { value: 0.99 } })}
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
        </div>
      )}
    </div>
  );
}