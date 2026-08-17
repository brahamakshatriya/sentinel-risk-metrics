'use client';

import { useState } from 'react';
import { formatCurrency, formatPercent, cn } from '@/lib/utils';
import { useScenario } from '@/hooks/useApi';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

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
      setResult({
        shockedValue: res.shocked_value,
        valueChange: res.value_change,
        valueChangePct: res.value_change_pct,
        originalVar95: res.original_var_95,
        shockedVar95: res.shocked_var_95,
        varChangePct: res.var_change_pct,
        originalVolatility: res.original_volatility,
        shockedVolatility: res.shocked_volatility,
      });
    } catch (err) {
      console.error('Scenario analysis failed:', err);
    }
  };

  const formatPct = (val: number) => `${val >= 0 ? '+' : ''}${val.toFixed(2)}%`;

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Scenario Lab</CardTitle>
            <CardDescription>
              Stress-test portfolio against market shocks. Illustrative only — not a risk model.
            </CardDescription>
          </div>
        </div>
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
              className="w-full"
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
              className="w-full"
            />
          </div>

          <div className="space-y-2">
            <Label>Current Portfolio Value</Label>
            <div className="p-3 rounded-lg bg-muted/50 border text-right font-mono font-medium">
              {formatCurrency(currentValue)}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Current VaR (95%)</Label>
            <div className="p-3 rounded-lg bg-muted/50 border text-right font-mono font-medium text-destructive">
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

        {/* Results */}
        {result && (
          <div className="space-y-4 p-4 rounded-lg border bg-muted/30 animate-in slide-in-from-top-2 duration-300">
            <h4 className="font-semibold">Scenario Results</h4>
            <p className="text-sm text-muted-foreground">
              Market drop: {marketDrop}% | Volatility spike: {volSpike}%
            </p>
            
            <div className="grid gap-4 md:grid-cols-3">
              <div className="p-4 rounded-lg bg-card border">
                <div className="text-sm text-muted-foreground">Portfolio Value</div>
                <div className="text-2xl font-bold font-mono mt-1">
                  {formatCurrency(result.shockedValue)}
                </div>
                <div className={cn('text-sm font-medium mt-1', result.valueChange >= 0 ? 'text-green-400' : 'text-red-400')}>
                  {formatPct(result.valueChangePct)} ({formatCurrency(result.valueChange)})
                </div>
              </div>

              <div className="p-4 rounded-lg bg-card border">
                <div className="text-sm text-muted-foreground">VaR (95%)</div>
                <div className="text-2xl font-bold font-mono mt-1 text-destructive">
                  {formatPct(result.shockedVar95)}
                </div>
                <div className={cn('text-sm font-medium mt-1', result.varChangePct >= 0 ? 'text-red-400' : 'text-green-400')}>
                  {formatPct(result.varChangePct)} change
                </div>
              </div>

              <div className="p-4 rounded-lg bg-card border">
                <div className="text-sm text-muted-foreground">Volatility</div>
                <div className="text-2xl font-bold font-mono mt-1">
                  {(result.shockedVolatility * 100).toFixed(2)}%
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  Was {(result.originalVolatility * 100).toFixed(2)}%
                </div>
              </div>
            </div>

            {/* Interpretation */}
            <div className="p-3 rounded-lg bg-muted/50 border text-sm">
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
          <div className="space-y-4 p-4 rounded-lg border bg-muted/30">
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