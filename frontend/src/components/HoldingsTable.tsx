'use client';

import { formatCurrency, formatPercent, formatNumber, getRiskColor, formatRelativeTime } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Holding } from '@/types/api';

interface HoldingsTableProps {
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
  totalValue: number;
  onDelete: (symbol: string) => void;
  isLoading?: boolean;
  error?: string | null;
  lastUpdated?: string | Date | null;
}

export function HoldingsTable({ holdings, totalValue, onDelete, isLoading, error, lastUpdated }: HoldingsTableProps) {
  if (isLoading) {
    return (
      <div className="rounded-lg border bg-card p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-muted rounded w-3/4" />
          <div className="h-4 bg-muted rounded w-1/2" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-muted rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border bg-card p-6 text-center">
        <p className="text-destructive mb-2">Failed to load holdings</p>
        <p className="text-sm text-muted-foreground mb-4">{error}</p>
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </div>
    );
  }

  if (!holdings.length) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center">
        <p className="text-muted-foreground mb-4">No holdings in this portfolio</p>
        <p className="text-sm text-muted-foreground mb-4">Add your first holding to get started</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b text-left text-sm font-medium text-muted-foreground">
              <th className="p-4">Symbol</th>
              <th className="p-4 text-right">Quantity</th>
              <th className="p-4 text-right">Avg Cost</th>
              <th className="p-4 text-right">Current</th>
              <th className="p-4 text-right">Weight</th>
              <th className="p-4 text-right">Market Value</th>
              <th className="p-4 text-right">P&L</th>
              <th className="p-4 text-right">P&L %</th>
              <th className="p-4"></th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((holding) => (
              <tr key={holding.symbol} className="border-b last:border-0 hover:bg-accent/50 transition-colors">
                <td className="p-4 font-mono font-medium">{holding.symbol}</td>
                <td className="p-4 text-right font-mono">{formatNumber(holding.quantity)}</td>
                <td className="p-4 text-right font-mono">{formatCurrency(holding.avg_cost)}</td>
                <td className="p-4 text-right font-mono">{formatCurrency(holding.current_price)}</td>
                <td className="p-4 text-right font-mono">
                  {formatPercent((holding.market_value / totalValue) * 100)}
                </td>
                <td className="p-4 text-right font-mono">{formatCurrency(holding.market_value)}</td>
                <td className="p-4 text-right font-mono">
                  <span className={cn('font-mono', getRiskColor(holding.pnl))}>
                    {holding.pnl >= 0 ? '+' : ''}{formatCurrency(holding.pnl)}
                  </span>
                </td>
                <td className="p-4 text-right font-mono">
                  <span className={cn('font-mono', getRiskColor(holding.pnl_pct))}>
                    {holding.pnl_pct >= 0 ? '+' : ''}{formatPercent(holding.pnl_pct)}
                  </span>
                </td>
                <td className="p-4 text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onDelete(holding.symbol)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="p-4 border-t bg-muted/50 flex items-center justify-between">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Total Portfolio Value</span>
          <span className="font-mono font-medium">{formatCurrency(totalValue)}</span>
        </div>
        {lastUpdated && (
          <span className="text-xs text-muted-foreground">
            Updated {formatRelativeTime(lastUpdated)}
          </span>
        )}
      </div>
    </div>
  );
}