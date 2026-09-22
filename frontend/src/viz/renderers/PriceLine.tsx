'use client';

import { useMemo } from 'react';
import { LineChart, Line } from '@/components/charts/line-chart';
import { Grid } from '@/components/charts/grid';
import { XAxis } from '@/components/charts/x-axis';
import { YAxis } from '@/components/charts/y-axis';
import { ChartTooltip } from '@/components/charts/tooltip/chart-tooltip';
import { formatCurrency, formatDate } from '@/lib/utils';
import type { CanonicalPriceHistory } from '@/viz/adapters/priceHistory';

/* Phase 4 — price-history line renderer (Bklit).
   Presentation ONLY: receives CanonicalPriceHistory, maps it to Bklit
   rows ({ date: Date, close }) without touching units, and renders the
   Sentinel card shell. No fetching, no coercion, no risk math.
   Requires non-empty points (the card owns loading/empty/error states). */

const PRICE_LINE = {
  stroke: '#A78BFA',
  grid: 'rgba(167,139,250,0.14)',
  crosshair: 'rgba(167,139,250,0.6)',
} as const;

interface PriceLineProps {
  data: CanonicalPriceHistory;
}

export function PriceLine({ data }: PriceLineProps) {
  /* Bklit rows + axis magnitude, derived once per canonical dataset.
     Date objects are built deterministically from canonical timestamps
     (local-noon strategy) — no invented observations. */
  const { rows, maxClose } = useMemo(() => {
    let max = 0;
    const mapped = data.points.map((p) => {
      if (p.close > max) max = p.close;
      return { date: new Date(p.timestamp), close: p.close };
    });
    return { rows: mapped, maxClose: max };
  }, [data]);

  const first = data.points[0];
  const last = data.points[data.points.length - 1];

  return (
    <div className="sentinel-card min-w-0 overflow-hidden">
      <div className="border-b border-[rgba(167,139,250,0.16)] p-4">
        <p className="eyebrow">Market data</p>
        <h4 className="mt-1 font-semibold text-foreground">{data.symbol} Price History</h4>
        <p className="text-sm text-muted-foreground">
          {data.points.length} daily bars · {first ? formatDate(first.date) : '—'} →{' '}
          {last ? formatDate(last.date) : '—'}
        </p>
      </div>
      <div className="h-[300px] p-4 sm:h-[350px]">
        <LineChart data={rows} style={{ height: '100%' }}>
          <Grid horizontal stroke={PRICE_LINE.grid} strokeDasharray="4,4" />
          <Line dataKey="close" stroke={PRICE_LINE.stroke} strokeWidth={2.5} />
          <XAxis />
          <YAxis
            formatValue={(v: number) =>
              Math.abs(maxClose) >= 10000
                ? `$${(v / 1000).toFixed(0)}k`
                : `$${Math.round(v).toLocaleString()}`
            }
          />
          <ChartTooltip
            indicatorColor={PRICE_LINE.crosshair}
            rows={(point) => [
              {
                color: PRICE_LINE.stroke,
                label: 'Close',
                value: formatCurrency((point.close as number) ?? 0),
              },
            ]}
          />
        </LineChart>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-[rgba(167,139,250,0.16)] bg-white/[0.015] p-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded" style={{ backgroundColor: PRICE_LINE.stroke }}></span>
          <span>Close · daily bars, gaps shown as gaps</span>
        </div>
      </div>
    </div>
  );
}
