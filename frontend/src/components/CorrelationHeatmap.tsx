'use client';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { formatPercent, formatRelativeTime } from '@/lib/utils';

interface CorrelationHeatmapProps {
  correlationMatrix: Record<string, Record<string, number>> | null;
  symbols: string[];
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  lastUpdated?: string | Date | null;
}

export function CorrelationHeatmap({ correlationMatrix, symbols, isLoading, error, onRetry, lastUpdated }: CorrelationHeatmapProps) {
  if (isLoading) {
    // P0 canonical state: Base-card container, skeleton blocks inside.
    return (
      <div className="sentinel-card p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-muted rounded-lg w-1/4" />
          <div className="grid grid-cols-5 gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 bg-muted rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="sentinel-card p-6 text-center" role="alert">
        <p className="text-red-300 font-medium mb-2">Failed to load correlation data</p>
        <p className="text-sm text-muted-foreground mb-4">{error}</p>
        <Button variant="outline" size="sm" onClick={() => onRetry?.()}>
          Retry
        </Button>
      </div>
    );
  }

  if (!correlationMatrix || Object.keys(correlationMatrix).length === 0) {
    // P0 canonical state: Base-card container, centered.
    return (
      <div className="sentinel-card p-6 text-center">
        <p className="text-muted-foreground">No correlation data available</p>
        <p className="text-sm text-muted-foreground mt-2">Run Sentinel calculation to generate correlation matrix</p>
      </div>
    );
  }

  // Get sorted symbols from matrix
  const matrixSymbols = Object.keys(correlationMatrix).sort();

  // Color scale (V2): cyan (negative) → neutral navy → violet (positive).
  // Diverging scale is preserved so correlation stays mathematically
  // interpretable — cells are never all-purple.
  const getColor = (value: number) => {
    const abs = Math.abs(value);
    const intensity = Math.min(0.12 + abs * 0.75, 0.88);
    if (value < -0.02) {
      return `rgba(34, 211, 238, ${intensity})`; // cyan
    }
    if (value > 0.02) {
      return `rgba(124, 58, 237, ${intensity})`; // violet
    }
    return 'rgba(148, 163, 184, 0.12)'; // neutral
  };

  const getTextColor = (value: number) => {
    const abs = Math.abs(value);
    return abs > 0.45 ? 'text-white' : 'text-foreground';
  };

  return (
    // Content-only: this component is embedded inside an outer Card that
    // already provides the "Correlation Matrix" title, so no duplicate
    // card chrome/header here.
    <div className="min-w-0">
      {lastUpdated && (
        <div className="pb-3 text-right text-xs text-muted-foreground">
          Updated {formatRelativeTime(lastUpdated)}
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-[rgba(167,139,250,0.16)] bg-[#070A12]/50">
        <table className="w-full min-w-max border-collapse">
          <thead className="sticky top-0 z-10 bg-card">
            <tr>
              <th className="w-16 p-2 text-left font-medium text-muted-foreground"></th>
              {matrixSymbols.map((symbol) => (
                <th
                  key={symbol}
                  className="p-2 text-center font-mono text-xs font-medium text-muted-foreground"
                >
                  <span title={symbol} className="block max-w-28 truncate">
                    {symbol}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrixSymbols.map((rowSymbol) => (
              <tr key={rowSymbol} className="border-t border-white/5">
                <td
                  className="sticky left-0 z-10 w-16 bg-[#0F172A] p-2 font-mono text-sm font-medium text-foreground"
                >
                  <span title={rowSymbol} className="block max-w-28 truncate">
                    {rowSymbol}
                  </span>
                </td>
                {matrixSymbols.map((colSymbol) => {
                  const value = correlationMatrix[rowSymbol]?.[colSymbol] ?? 0;
                  return (
                    <td key={colSymbol} className="h-14 w-14 p-1 sm:h-16 sm:w-16 sm:p-1.5 lg:h-[4.5rem] lg:w-[4.5rem] lg:p-2">
                      <div
                        className={cn(
                          'flex h-full w-full items-center justify-center rounded-lg border border-white/10 font-mono text-[11px] tabular-nums transition-all duration-200 hover:scale-[1.04] hover:border-[rgba(167,139,250,0.5)] hover:shadow-[0_0_0_1px_rgba(167,139,250,0.3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-xs',
                          getTextColor(value)
                        )}
                        style={{ backgroundColor: getColor(value) }}
                        title={`${rowSymbol} vs ${colSymbol}: ${value.toFixed(3)}`}
                        tabIndex={0}
                        role="img"
                        aria-label={`${rowSymbol} versus ${colSymbol} correlation ${value.toFixed(3)}`}
                      >
                        {value.toFixed(2)}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pt-3">
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded" style={{ backgroundColor: 'rgba(34, 211, 238, 0.8)' }}></span>
            <span>Negative (−1)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded border border-white/10" style={{ backgroundColor: 'rgba(148, 163, 184, 0.12)' }}></span>
            <span>Zero</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded" style={{ backgroundColor: 'rgba(124, 58, 237, 0.85)' }}></span>
            <span>Positive (+1)</span>
          </div>
        </div>
      </div>
    </div>
  );
}