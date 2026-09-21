'use client';

import { useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { formatCurrency } from '@/lib/utils';
import type { TerminalDistributionDisplayData } from '@/viz/adapters/terminalValue';

/* Phase 3B — density visualization renderer.
   Visual rendering ONLY: receives the SAME normalized display data as
   the histogram (TerminalValueAdapter output). Knows nothing about API
   contracts, string coercion, VaR calculation, simulation, or fetching.

   Methodology (explicit, histogram-derived density estimate):
     density ≈ count / (N × binWidth)
   per adapter bin, plotted at the bin midpoint. No new observations are
   fabricated; the curve integrates to ~1 over the binned range (modulo
   the preserved histogram quirk that the final bin excludes values
   exactly equal to the maximum). No statistics dependency was added;
   no kernel density estimate is claimed.

   Palette/typography/spacing/axes/tooltip/legend reuse the existing
   Sentinel token families (fan bands, histogram legend, VaR amber). */

const DENSITY_CHART = {
  grid: 'rgba(167,139,250,0.14)',
  tick: '#94A3B8',
  varThreshold: '#F59E0B',
  densityStroke: 'rgba(167,139,250,0.8)',
  densityFill: 'rgba(124,58,237,0.28)',
  tooltipBg: 'rgba(7,10,18,0.94)',
} as const;

const densityTooltipStyle = {
  backgroundColor: DENSITY_CHART.tooltipBg,
  border: '1px solid rgba(167,139,250,0.16)',
  borderRadius: 10,
  fontSize: 12,
} as const;

export interface DensityPoint {
  readonly x: number;
  readonly density: number;
  readonly count: number;
  readonly range: string;
  readonly isTail: boolean;
}

/* Pure representation transform of display data (not a second adapter:
   input is already-normalized display data, output is renderer points).
   Kept outside JSX and exported for validation. Non-finite points are
   dropped for rendering safety under the existing adapter convention
   that non-finite canonical values propagate verbatim. */
export function toDensityPoints(data: TerminalDistributionDisplayData): DensityPoint[] {
  if (data.simulationCount <= 0) return [];
  return data.bins
    .map((bin) => {
      const width = bin.rangeEnd - bin.rangeStart;
      const midpoint = (bin.rangeStart + bin.rangeEnd) / 2;
      const density = width > 0 ? bin.count / (data.simulationCount * width) : 0;
      return {
        x: midpoint,
        density,
        count: bin.count,
        range: bin.range,
        isTail: bin.isTail,
      };
    })
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.density));
}

interface TerminalDensityProps {
  data: TerminalDistributionDisplayData;
}

export function TerminalDensity({ data }: TerminalDensityProps) {
  /* Derived once per canonical dataset (bins are O(30)); the component
     never recomputes on unrelated re-renders. */
  const points = useMemo(() => toDensityPoints(data), [data]);
  const pointByX = useMemo(() => new Map(points.map((p) => [p.x, p])), [points]);

  if (points.length === 0) {
    return (
      <div className="sentinel-card min-w-0 overflow-hidden">
        <div className="border-b border-[rgba(167,139,250,0.16)] p-4">
          <p className="eyebrow">Distribution</p>
          <h4 className="mt-1 font-semibold text-foreground">Final Value Density</h4>
          <p className="text-sm text-muted-foreground">
            {data.simulationCount} simulations · histogram-based density · VaR threshold marked
          </p>
        </div>
        <div className="p-6 text-center">
          <p className="text-muted-foreground">No distribution data available for this simulation.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="sentinel-card min-w-0 overflow-hidden">
      <div className="border-b border-[rgba(167,139,250,0.16)] p-4">
        <p className="eyebrow">Distribution</p>
        <h4 className="mt-1 font-semibold text-foreground">Final Value Density</h4>
        <p className="text-sm text-muted-foreground">
          {data.simulationCount} simulations · histogram-based density · VaR threshold marked
        </p>
      </div>
      <div className="h-[300px] p-4 sm:h-[350px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={DENSITY_CHART.grid} />
            <XAxis
              dataKey="x"
              type="number"
              domain={['dataMin', 'dataMax']}
              tick={{ fontSize: 10, fill: DENSITY_CHART.tick }}
              tickFormatter={(v: number) =>
                Math.abs(data.maxValue) >= 10000
                  ? `$${(v / 1000).toFixed(0)}k`
                  : `$${Math.round(v).toLocaleString()}`
              }
              tickLine={false}
              axisLine={{ stroke: DENSITY_CHART.grid }}
            />
            <YAxis
              tick={{ fontSize: 10, fill: DENSITY_CHART.tick }}
              tickFormatter={(v: number) => (v === 0 ? '0' : v.toExponential(0))}
              width={64}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              contentStyle={densityTooltipStyle}
              labelStyle={{ color: '#F8FAFC' }}
              formatter={(value: number) => [value.toExponential(2), 'Density']}
              labelFormatter={(x: number) => {
                const point = pointByX.get(x);
                const tail = point?.isTail ? ' · below VaR threshold' : '';
                return `Final value ≈ ${formatCurrency(x)} (${point?.count ?? 0} sims${tail})`;
              }}
            />
            <Area
              type="monotone"
              dataKey="density"
              stroke={DENSITY_CHART.densityStroke}
              strokeWidth={2}
              fill={DENSITY_CHART.densityFill}
              dot={false}
              name="Density"
            />
            <ReferenceLine
              x={data.varThreshold}
              stroke={DENSITY_CHART.varThreshold}
              strokeWidth={1}
              strokeDasharray="5 5"
              label={{ value: 'VaR Threshold', position: 'insideTopRight', fontSize: 10, fill: DENSITY_CHART.varThreshold }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-[rgba(167,139,250,0.16)] bg-white/[0.015] p-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded" style={{ backgroundColor: DENSITY_CHART.densityFill }}></span>
          <span>Density (share of sims per dollar)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: DENSITY_CHART.varThreshold }}></span>
          <span>VaR: {formatCurrency(data.varThreshold)}</span>
        </div>
      </div>
    </div>
  );
}
