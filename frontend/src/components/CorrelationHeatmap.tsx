'use client';

import { cn } from '@/lib/utils';
import { formatPercent, formatRelativeTime } from '@/lib/utils';

interface CorrelationHeatmapProps {
  correlationMatrix: Record<string, Record<string, number>> | null;
  symbols: string[];
  isLoading?: boolean;
  error?: string | null;
  lastUpdated?: string | Date | null;
}

export function CorrelationHeatmap({ correlationMatrix, symbols, isLoading, error, lastUpdated }: CorrelationHeatmapProps) {
  if (isLoading) {
    return (
      <div className="rounded-lg border bg-card p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-muted rounded w-1/4" />
          <div className="grid grid-cols-5 gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 bg-muted rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border bg-card p-6 text-center">
        <p className="text-destructive mb-2">Failed to load correlation data</p>
        <p className="text-sm text-muted-foreground mb-4">{error}</p>
        <button 
          className="text-sm text-primary hover:underline"
          onClick={() => window.location.reload()}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!correlationMatrix || Object.keys(correlationMatrix).length === 0) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center">
        <p className="text-muted-foreground">No correlation data available</p>
        <p className="text-sm text-muted-foreground mt-2">Run Sentinel calculation to generate correlation matrix</p>
      </div>
    );
  }

  // Get sorted symbols from matrix
  const matrixSymbols = Object.keys(correlationMatrix).sort();

  // Color scale: blue (negative) -> white (0) -> red (positive)
  const getColor = (value: number) => {
    const abs = Math.abs(value);
    const intensity = Math.min(abs * 2, 1); // Scale 0-1 for 0-0.5 range
    if (value < 0) {
      return `rgba(59, 130, 246, ${intensity})`; // blue
    } else {
      return `rgba(239, 68, 68, ${intensity})`; // red
    }
  };

  const getTextColor = (value: number) => {
    const abs = Math.abs(value);
    return abs > 0.5 ? 'text-white' : 'text-foreground';
  };

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="p-4 border-b flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Correlation Matrix</h3>
          <p className="text-sm text-muted-foreground">Pearson correlation of daily returns</p>
        </div>
        {lastUpdated && (
          <span className="text-xs text-muted-foreground">
            Updated {formatRelativeTime(lastUpdated)}
          </span>
        )}
      </div>
      <div className="overflow-x-auto p-4">
        <table className="w-auto min-w-full border-collapse">
          <thead>
            <tr>
              <th className="w-20 text-left p-2 font-medium text-muted-foreground"></th>
              {matrixSymbols.map((symbol) => (
                <th key={symbol} className="w-20 text-center p-2 font-mono text-xs font-medium text-muted-foreground">
                  {symbol}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrixSymbols.map((rowSymbol) => (
              <tr key={rowSymbol}>
                <td className="w-20 p-2 font-mono text-sm font-medium sticky left-0 bg-card/50 border-r border-border">
                  {rowSymbol}
                </td>
                {matrixSymbols.map((colSymbol) => {
                  const value = correlationMatrix[rowSymbol]?.[colSymbol] ?? 0;
                  return (
                    <td key={colSymbol} className="w-20 h-20 p-2">
                      <div
                        className={cn(
                          'w-full h-full rounded border border-border/50 flex items-center justify-center font-mono text-xs',
                          getTextColor(value)
                        )}
                        style={{ backgroundColor: getColor(value) }}
                        title={`${rowSymbol} vs ${colSymbol}: ${value.toFixed(3)}`}
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
      <div className="p-4 border-t bg-muted/30">
        <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <span className="w-3 h-3 rounded" style={{ backgroundColor: 'rgba(59, 130, 246, 0.8)' }}></span>
            <span>Negative</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-3 h-3 rounded" style={{ backgroundColor: 'rgba(255, 255, 255, 0.1)' }}></span>
            <span>Zero</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-3 h-3 rounded" style={{ backgroundColor: 'rgba(239, 68, 68, 0.8)' }}></span>
            <span>Positive</span>
          </div>
        </div>
      </div>
    </div>
  );
}