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
  onDelete?: (symbol: string) => void;
  onRetry?: () => void;
  isLoading?: boolean;
  error?: string | null;
  lastUpdated?: string | Date | null;
  readOnly?: boolean;
}

export function HoldingsTable({ holdings, totalValue, onDelete, onRetry, isLoading, error, lastUpdated, readOnly = false }: HoldingsTableProps) {
  if (isLoading) {
    // P0 canonical state: Base-card container, skeleton blocks inside.
    return (
      <div className="sentinel-card p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-muted rounded-lg w-3/4" />
          <div className="h-4 bg-muted rounded-lg w-1/2" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-muted rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="sentinel-card p-6 text-center" role="alert">
        <p className="text-red-300 font-medium mb-2">Failed to load holdings</p>
        <p className="text-sm text-muted-foreground mb-4">{error}</p>
        <Button variant="outline" size="sm" onClick={() => onRetry?.()}>
          Retry
        </Button>
      </div>
    );
  }

  if (!holdings.length) {
    // P0 canonical state: Base-card container, centered.
    return (
      <div className="sentinel-card p-6 text-center">
        <p className="text-muted-foreground mb-4">No holdings in this portfolio</p>
        <p className="text-sm text-muted-foreground mb-4">Add your first holding to get started</p>
      </div>
    );
  }

  return (
    <div className="sentinel-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[rgba(167,139,250,0.16)] bg-white/[0.015] text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <th className="p-4">Symbol</th>
              <th className="p-4 text-right">Quantity</th>
              <th className="p-4 text-right">Avg Cost</th>
              <th className="p-4 text-right">Current</th>
              <th className="p-4 text-right">Weight</th>
              <th className="p-4 text-right">Market Value</th>
              <th className="p-4 text-right">P&L</th>
              <th className="p-4 text-right">P&L %</th>
              {!readOnly && <th className="p-4"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {holdings.map((holding) => (
              <tr key={holding.symbol} className="border-b border-white/5 last:border-0 hover:bg-[rgba(124,58,237,0.07)] transition-colors duration-200">
                <td className="p-4 font-mono font-semibold text-foreground">
                  <span className="inline-flex items-center gap-2">
                    <span aria-hidden="true" className="h-6 w-0.5 rounded-full bg-gradient-to-b from-[#7C3AED] to-[#22D3EE]" />
                    {holding.symbol}
                  </span>
                </td>
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
                  {!readOnly && onDelete && (
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
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-[rgba(167,139,250,0.16)] bg-white/[0.015] p-4">
        <div className="flex items-baseline gap-3 text-sm">
          <span className="eyebrow">Total Portfolio Value</span>
          <span className="metric-value font-mono text-lg">{formatCurrency(totalValue)}</span>
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