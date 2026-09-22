'use client';

import { useMemo } from 'react';
import { CandlestickChart } from '@/components/charts/candlestick-chart';
import { Candlestick } from '@/components/charts/candlestick';
import { Grid } from '@/components/charts/grid';
import { XAxis } from '@/components/charts/x-axis';
import { YAxis } from '@/components/charts/y-axis';
import { ChartTooltip } from '@/components/charts/tooltip/chart-tooltip';
import { formatCurrency, formatDate } from '@/lib/utils';
import type { CanonicalPriceHistory } from '@/viz/adapters/priceHistory';

/* Phase 4 — price-history candlestick renderer (Bklit).
   Genuine OHLC only: rows are built exclusively from points carrying
   all four finite values. NOTHING is synthesized — no open = close,
   no high/low = close, no previous-close carry. The registry gate
   (flags.hasOHLC) keeps this view unreachable otherwise; the filter
   below is defense-in-depth, not a fallback data source.
   Up/down fills follow Sentinel's existing semantic tokens
   (emerald-400 / red-400, as in getRiskColor). */

const PRICE_CANDLE = {
  positiveFill: '#34D399',
  negativeFill: '#F87160',
  grid: 'rgba(167,139,250,0.14)',
  crosshair: 'rgba(167,139,250,0.6)',
} as const;

interface PriceCandlestickProps {
  data: CanonicalPriceHistory;
}

export function PriceCandlestick({ data }: PriceCandlestickProps) {
  const { rows, maxHigh } = useMemo(() => {
    let max = 0;
    const mapped = data.points
      .filter(
        (p) =>
          p.open !== undefined &&
          p.high !== undefined &&
          p.low !== undefined &&
          Number.isFinite(p.open) &&
          Number.isFinite(p.high) &&
          Number.isFinite(p.low)
      )
      .map((p) => {
        if ((p.high as number) > max) max = p.high as number;
        return {
          date: new Date(p.timestamp),
          open: p.open as number,
          high: p.high as number,
          low: p.low as number,
          close: p.close,
        };
      });
    return { rows: mapped, maxHigh: max };
  }, [data]);

  const first = data.points[0];
  const last = data.points[data.points.length - 1];

  return (
    <div className="sentinel-card min-w-0 overflow-hidden">
      <div className="border-b border-[rgba(167,139,250,0.16)] p-4">
        <p className="eyebrow">Market data</p>
        <h4 className="mt-1 font-semibold text-foreground">{data.symbol} Price History</h4>
        <p className="text-sm text-muted-foreground">
          {rows.length} daily candles · {first ? formatDate(first.date) : '—'} →{' '}
          {last ? formatDate(last.date) : '—'}
        </p>
      </div>
      <div className="h-[300px] p-4 sm:h-[350px]">
        <CandlestickChart data={rows} style={{ height: '100%' }}>
          <Grid horizontal stroke={PRICE_CANDLE.grid} strokeDasharray="4,4" />
          <Candlestick
            positiveFill={PRICE_CANDLE.positiveFill}
            negativeFill={PRICE_CANDLE.negativeFill}
          />
          <XAxis />
          <YAxis
            formatValue={(v: number) =>
              Math.abs(maxHigh) >= 10000
                ? `$${(v / 1000).toFixed(0)}k`
                : `$${Math.round(v).toLocaleString()}`
            }
          />
          <ChartTooltip
            indicatorColor={PRICE_CANDLE.crosshair}
            rows={(point) => [
              { color: PRICE_CANDLE.positiveFill, label: 'Open', value: formatCurrency((point.open as number) ?? 0) },
              { color: PRICE_CANDLE.positiveFill, label: 'High', value: formatCurrency((point.high as number) ?? 0) },
              { color: PRICE_CANDLE.negativeFill, label: 'Low', value: formatCurrency((point.low as number) ?? 0) },
              { color: PRICE_CANDLE.negativeFill, label: 'Close', value: formatCurrency((point.close as number) ?? 0) },
            ]}
          />
        </CandlestickChart>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-[rgba(167,139,250,0.16)] bg-white/[0.015] p-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded" style={{ backgroundColor: PRICE_CANDLE.positiveFill }}></span>
          <span>Up (close ≥ open)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded" style={{ backgroundColor: PRICE_CANDLE.negativeFill }}></span>
          <span>Down (close &lt; open)</span>
        </div>
      </div>
    </div>
  );
}
