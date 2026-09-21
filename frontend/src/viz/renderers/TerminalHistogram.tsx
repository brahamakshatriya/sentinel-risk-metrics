'use client';

import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { formatCurrency } from '@/lib/utils';
import type { TerminalDistributionDisplayData } from '@/viz/adapters/terminalValue';

/* Phase 3A — histogram visualization renderer.
   Visual rendering ONLY: receives normalized display data from
   TerminalValueAdapter. Knows nothing about API contracts, string
   coercion, binning, or VaR calculation.

   Palette/typography/spacing/axes/tooltip/legend are verbatim from the
   pre-extraction MonteCarloChart (single intentional scoping: the
   histogram tokens live here so the fan chart in MonteCarloChart is
   untouched; a shared chart theme is a later phase). */

const HISTOGRAM_CHART = {
  grid: 'rgba(167,139,250,0.14)',
  tick: '#94A3B8',
  varThreshold: '#F59E0B',
  histBase: 'rgba(34,211,238,0.55)',
  histTail: 'rgba(239,68,68,0.75)',
  tooltipBg: 'rgba(7,10,18,0.94)',
} as const;

const histogramTooltipStyle = {
  backgroundColor: HISTOGRAM_CHART.tooltipBg,
  border: '1px solid rgba(167,139,250,0.16)',
  borderRadius: 10,
  fontSize: 12,
} as const;

interface TerminalHistogramProps {
  data: TerminalDistributionDisplayData;
}

export function TerminalHistogram({ data }: TerminalHistogramProps) {
  return (
    <div className="sentinel-card min-w-0 overflow-hidden">
      <div className="border-b border-[rgba(167,139,250,0.16)] p-4">
        <p className="eyebrow">Distribution</p>
        <h4 className="mt-1 font-semibold text-foreground">Final Value Distribution</h4>
        <p className="text-sm text-muted-foreground">
          {data.simulationCount} simulations · VaR threshold marked
        </p>
      </div>
      <div className="h-[300px] p-4 sm:h-[350px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.bins as unknown as Record<string, unknown>[]} layout="vertical" margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={HISTOGRAM_CHART.grid} vertical={false} />
            <XAxis type="number" tick={{ fontSize: 10, fill: HISTOGRAM_CHART.tick }} tickFormatter={(v) => v.toLocaleString()} tickLine={false} axisLine={{ stroke: HISTOGRAM_CHART.grid }} />
            <YAxis
              type="category"
              dataKey="range"
              tick={{ fontSize: 9, fill: HISTOGRAM_CHART.tick }}
              width={88}
              tickLine={false}
              axisLine={false}
              interval={2}
            />
            <Tooltip
              contentStyle={histogramTooltipStyle}
              labelStyle={{ color: '#F8FAFC' }}
              formatter={(value: number, name: string) => [value.toLocaleString(), name]}
              labelFormatter={(range) => `Final Value: ${range}`}
            />
            <Bar
              dataKey="count"
              radius={[0, 4, 4, 0]}
              name="Frequency"
            >
              {data.bins.map((bin, index) => (
                <Cell
                  key={index}
                  fill={bin.isTail ? HISTOGRAM_CHART.histTail : HISTOGRAM_CHART.histBase}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-[rgba(167,139,250,0.16)] bg-white/[0.015] p-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded" style={{ backgroundColor: HISTOGRAM_CHART.histTail }}></span>
          <span>Loss Tail (VaR)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded" style={{ backgroundColor: HISTOGRAM_CHART.histBase }}></span>
          <span>Gain/Neutral</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: HISTOGRAM_CHART.varThreshold }}></span>
          <span>VaR: {formatCurrency(data.varThreshold)}</span>
        </div>
      </div>
    </div>
  );
}
