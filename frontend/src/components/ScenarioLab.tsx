'use client';

import { useState } from 'react';
import { formatCurrency, formatPercent } from '@/lib/utils';
import { useScenario } from '@/hooks/useApi';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { MetricCard } from '@/components/MetricCard';

interface ScenarioLabProps {
  portfolioId: number;
  portfolioName: string;
  currentValue: number;
  currentVar95: number;
  currentVolatility: number;
}

export function ScenarioLab({ 
  portfolioId, 
  portfolioName, 
  currentValue, 
  currentVar95, 
  currentVolatility 
}: ScenarioLabProps) {
  const [marketDrop, setMarketDrop] = useState(-20);
  const [volSpike, setVolSpike] = useState(50);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const runScenario = useScenario();
  const [result, setResult] = useState<{
    shockedValue: number;
    valueChange: number;
    valueChangePct: number;
    originalVar95: number;
    shockedVar95: number;
    varChangePct: number;
    originalVolatility: number;
    shockedVolatility: number;
  } | null>(null);

  const handleRun = async () => {
    try {
      const res = await runScenario.mutateAsync({
        portfolio_id: portfolioId,
        market_drop_pct: marketDrop,
        vol_spike_pct: volSpike,
      });
      // Backend Decimal fields serialize as JSON strings (Pydantic v2), so
      // coerce at the boundary — same parseFloat convention used by the
      // portfolio-value / risk-metrics / Monte Carlo consumers. Without this,
      // formatPct's val.toFixed() throws TypeError during render (strings have
      // no toFixed) and Next.js shows a client-side exception page.
      setResult({
        shockedValue: parseFloat(res.shocked_value as unknown as string),
        valueChange: parseFloat(res.value_change as unknown as string),
        valueChangePct: parseFloat(res.value_change_pct as unknown as string),
        originalVar95: parseFloat(res.original_var_95 as unknown as string),
        shockedVar95: parseFloat(res.shocked_var_95 as unknown as string),
        varChangePct: parseFloat(res.var_change_pct as unknown as string),
        originalVolatility: parseFloat(res.original_volatility as unknown as string),
        shockedVolatility: parseFloat(res.shocked_volatility as unknown as string),
      });
    } catch (err) {
      console.error('Scenario analysis failed:', err);
    }
  };

  const formatPct = (val: number) => `${val >= 0 ? '+' : ''}${val.toFixed(2)}%`;

  return (
    <Card className="w-full overflow-hidden">
      <CardHeader>
        <p className="eyebrow">Stress testing</p>
        <CardTitle className="mt-1 text-xl">Scenario Lab</CardTitle>
        <CardDescription>
          Stress-test portfolio against market shocks. Illustrative only — not a risk model.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Controls */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="marketDrop">Market Drop (%)</Label>
            <div className="relative">
              <Input
                id="marketDrop"
                type="number"
                min="-50"
                max="0"
                step="1"
                value={marketDrop}
                onChange={(e) => setMarketDrop(Math.max(-50, Math.min(0, parseInt(e.target.value) || 0)))}
                disabled={runScenario.isPending}
                className="pr-10"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
            </div>
            <input
              type="range"
              min="-50"
              max="0"
              step="1"
              value={marketDrop}
              onChange={(e) => setMarketDrop(parseInt(e.target.value))}
              disabled={runScenario.isPending}
              className="sentinel-range"
              aria-label="Market drop percent"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="volSpike">Volatility Spike (%)</Label>
            <div className="relative">
              <Input
                id="volSpike"
                type="number"
                min="0"
                max="200"
                step="1"
                value={volSpike}
                onChange={(e) => setVolSpike(Math.max(0, Math.min(200, parseInt(e.target.value) || 0)))}
                disabled={runScenario.isPending}
                className="pr-10"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
            </div>
            <input
              type="range"
              min="0"
              max="200"
              step="1"
              value={volSpike}
              onChange={(e) => setVolSpike(parseInt(e.target.value))}
              disabled={runScenario.isPending}
              className="sentinel-range"
              aria-label="Volatility spike percent"
            />
          </div>

          <div className="space-y-2">
            <Label>Current Portfolio Value</Label>
            {/* P1: readout well — canonical inner surface, typography preserved. */}
            <div className="sentinel-inset text-right font-mono font-semibold text-foreground tabular-nums">
              {formatCurrency(currentValue)}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Current VaR (95%)</Label>
            <div className="sentinel-inset text-right font-mono font-semibold text-red-300 tabular-nums">
              {formatPct(currentVar95 * 100)}
            </div>
          </div>
        </div>

        {/* Run Button */}
        <div className="flex gap-2">
          <Button 
            onClick={handleRun} 
            disabled={runScenario.isPending}
            className="flex-1"
            size="lg"
          >
            {runScenario.isPending ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Running Scenario...
              </span>
            ) : (
              'Run Stress Test'
            )}
          </Button>
          <Button 
            variant="outline" 
            onClick={() => setShowAdvanced(!showAdvanced)}
            disabled={runScenario.isPending}
          >
            {showAdvanced ? 'Hide Details' : 'Show Details'}
          </Button>
        </div>

        {/* Results — P1: metrics use the canonical MetricCard (no bespoke
            tiles); the cyan info tint is retired in favor of the V2 hierarchy.
            Values, formatting, trend semantics, and copy preserved. */}
        {result && (
          <div className="space-y-4">
            <p className="eyebrow">Scenario Results</p>
            <p className="text-sm text-muted-foreground">
              Market drop: {marketDrop}% | Volatility spike: {volSpike}%
            </p>

            <div className="grid gap-4 md:grid-cols-3">
              <MetricCard
                title="Portfolio Value"
                value={result.shockedValue}
                format="currency"
                decimals={2}
                mono
                trend={result.valueChange >= 0 ? 'up' : 'down'}
                subtitle={`${formatPct(result.valueChangePct)} (${formatCurrency(result.valueChange)})`}
              />

              <MetricCard
                title="VaR (95%)"
                value={result.shockedVar95}
                format="percent"
                decimals={2}
                mono
                trend={result.varChangePct >= 0 ? 'down' : 'up'}
                subtitle={`${formatPct(result.varChangePct)} change`}
              />

              <MetricCard
                title="Volatility"
                value={result.shockedVolatility * 100}
                format="percent"
                decimals={2}
                mono
                subtitle={`Was ${(result.originalVolatility * 100).toFixed(2)}%`}
              />
            </div>

            {/* Interpretation */}
            <div className="sentinel-inset text-sm">
              <strong>Interpretation: </strong>
              {result.valueChange < 0 ? (
                <>
                  A {Math.abs(marketDrop)}% market drop with {volSpike}% volatility spike would reduce portfolio value by 
                  <span className="font-mono font-medium text-red-400">{formatCurrency(Math.abs(result.valueChange))}</span> 
                  ({formatPct(Math.abs(result.valueChangePct))}). 
                  VaR increases by {formatPct(Math.abs(result.varChangePct))}, indicating higher tail risk.
                </>
              ) : (
                <>
                  Portfolio shows resilience under this scenario.
                </>
              )}
            </div>
          </div>
        )}

        {runScenario.error && (
          <div className="p-4 rounded-lg border bg-destructive/10 text-destructive">
            <p className="font-medium">Scenario analysis failed</p>
            <p className="text-sm mt-1">{runScenario.error instanceof Error ? runScenario.error.message : String(runScenario.error)}</p>
          </div>
        )}

        {/* Advanced Options */}
        {showAdvanced && (
          <div className="sentinel-inset space-y-4">
            <h4 className="font-semibold">About This Analysis</h4>
            <ul className="text-sm text-muted-foreground space-y-2">
              <li>• <strong>Market Drop:</strong> Applies a uniform daily return shock across all holdings</li>
              <li>• <strong>Volatility Spike:</strong> Scales all asset return deviations from their mean</li>
              <li>• <strong>Methodology:</strong> Shock applied to historical returns → recalculates VaR & volatility</li>
              <li>• <strong>Limitations:</strong> Assumes correlations hold under stress; no liquidity or gap risk modeled</li>
              <li>• <strong>Use Case:</strong> Illustrative stress testing — not a substitute for regulatory stress tests</li>
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}