'use client';

import { useMemo, useState } from 'react';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from 'recharts';
import { formatCurrency, formatPercent, formatRelativeTime } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { MetricCard } from '@/components/MetricCard';
import { adaptTerminalDistribution, DEFAULT_TERMINAL_BIN_COUNT } from '@/viz/adapters/terminalValue';
import {
  resolveTerminalDistributionView,
  TERMINAL_DISTRIBUTION_REGISTRY,
  type TerminalDistributionViewId,
} from '@/viz/registry';
import { TerminalHistogram } from '@/viz/renderers/TerminalHistogram';
import { TerminalDensity } from '@/viz/renderers/TerminalDensity';

/* Sentinel V2 chart language — single source for Monte Carlo accents:
   violet = primary analytical · cyan = secondary/comparison ·
   lavender = supporting · amber/red stay semantic (VaR / loss tail). */
const CHART = {
  grid: 'rgba(167,139,250,0.14)',
  tick: '#94A3B8',
  median: '#22D3EE',
  bandOuter: 'rgba(167,139,250,0.16)',
  bandOuterStroke: 'rgba(167,139,250,0.45)',
  bandInnerLow: 'rgba(124,58,237,0.28)',
  bandInnerLowStroke: 'rgba(124,58,237,0.6)',
  bandInnerHigh: 'rgba(34,211,238,0.22)',
  bandInnerHighStroke: 'rgba(34,211,238,0.55)',
  varThreshold: '#F59E0B',
  histBase: 'rgba(34,211,238,0.55)',
  histTail: 'rgba(239,68,68,0.75)',
  tooltipBg: 'rgba(7,10,18,0.94)',
} as const;

const chartTooltipStyle = {
  backgroundColor: CHART.tooltipBg,
  border: '1px solid rgba(167,139,250,0.16)',
  borderRadius: 10,
  fontSize: 12,
} as const;

interface MonteCarloChartProps {
  data: {
    simulated_paths_sample: number[][];
    current_value: number;
    var: number;
    cvar: number;
    mean_final_value: number;
    percentiles: {
      p5: number;
      p25: number;
      p50: number;
      p75: number;
      p95: number;
    };
    return_percentiles: {
      p5: number;
      p25: number;
      p50: number;
      p75: number;
      p95: number;
    };
    prob_loss: number;
    prob_gain: number;
    var_pct: number;
    cvar_pct: number;
  } | null;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  lastUpdated?: string | Date | null;
}

export function MonteCarloChart({ data, isLoading, error, onRetry, lastUpdated }: MonteCarloChartProps) {
  /* Phase 3A — terminal-distribution slice: canonical MC data (coerced by
     the caller) → TerminalValueAdapter → registry-resolved histogram
     renderer. Memoized on the canonical payload so view rendering never
     recomputes bins; placed before the state guards so hook order is
     stable across loading/empty/ready transitions. */
  const distribution = useMemo(() => {
    if (!data || !data.simulated_paths_sample?.length) return null;
    const samplePaths = data.simulated_paths_sample;
    const horizonDays = samplePaths[0]?.length ?? 0;
    return adaptTerminalDistribution(
      {
        finalValues: samplePaths.map((p) => p[horizonDays - 1]),
        currentValue: data.current_value,
        var: data.var,
      },
      { binCount: DEFAULT_TERMINAL_BIN_COUNT }
    );
  }, [data]);
  /* TEMPORARY Phase-3B proof selection — NOT the future product
     ViewSwitcher. Local typed state initialized to the registry default
     (histogram); the permanent switcher will own this seam later. */
  const [proofViewId, setProofViewId] = useState<TerminalDistributionViewId>(
    TERMINAL_DISTRIBUTION_REGISTRY.defaultViewId
  );
  /* Centralized resolution stays the authority for valid/default/renderer
     mapping; invalid ids fall back to the histogram default. */
  const distributionView = resolveTerminalDistributionView(proofViewId);

  if (isLoading) {
    // P0 canonical state: Base-card container, skeleton blocks inside.
    return (
      <div className="sentinel-card p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-muted rounded-lg w-1/4" />
          <div className="h-64 bg-muted rounded-lg" />
          <div className="h-64 bg-muted rounded-lg" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="sentinel-card p-6 text-center" role="alert">
        <p className="text-red-300 font-medium mb-2">Failed to load Monte Carlo data</p>
        <p className="text-sm text-muted-foreground mb-4">{error}</p>
        <Button variant="outline" size="sm" onClick={() => onRetry?.()}>
          Retry
        </Button>
      </div>
    );
  }

  if (!data || !data.simulated_paths_sample?.length) {
    // P0 canonical state: Base-card container, centered.
    return (
      <div className="sentinel-card p-6 text-center">
        <p className="text-muted-foreground">No Monte Carlo data available. Run a simulation first.</p>
      </div>
    );
  }

  const paths = data.simulated_paths_sample;
  const days = paths[0]?.length ?? 0;

  const percentileData = [];
  for (let day = 0; day < days; day++) {
    const dayValues = paths.map((p) => p[day]).sort((a, b) => a - b);
    const n = dayValues.length;
    const p5 = dayValues[Math.floor(0.05 * n)];
    const p25 = dayValues[Math.floor(0.25 * n)];
    const p50 = dayValues[Math.floor(0.5 * n)];
    const p75 = dayValues[Math.floor(0.75 * n)];
    const p95 = dayValues[Math.floor(0.95 * n)];
    // Stacked deltas so the fan bands render between percentiles instead of
    // overlapping as full fills down to the axis. Order (bottom-up):
    // p5 base (invisible) -> 5-25th -> 25-50th -> 50-75th -> 75-95th.
    percentileData.push({
      day,
      p5,
      p50,
      bandOuterLow: Math.max(p25 - p5, 0),
      bandInnerLow: Math.max(p50 - p25, 0),
      bandInnerHigh: Math.max(p75 - p50, 0),
      bandOuterHigh: Math.max(p95 - p75, 0),
    });
  }

  const varThreshold = data.current_value - data.var;

  // Adaptive Y-axis labels: $k shorthand only when values are large enough
  // for it to stay readable; otherwise show full dollar amounts.
  // Magnitude gate reads the adapter's metadata so the terminal derivation
  // lives in exactly one place (distribution is non-null here — same
  // condition as the data guard above).
  const yTickFormatter = (v: number) =>
    Math.abs(distribution?.maxValue ?? 0) >= 10000 ? `$${(v / 1000).toFixed(0)}k` : `$${Math.round(v).toLocaleString()}`;

  return (
    // Content-only: embedded inside an outer Card that already provides the
    // "Monte Carlo Simulation" title, so no duplicate card chrome here.
    <div className="min-w-0">
      {/* Metric Cards — canonical V2-Metric (shared MetricCard).
          Previously a file-local duplicate with its own bg/padding/type;
          now unified: default size would dominate this dense chart grid,
          so analytical `micro + mono` keeps hierarchy under the outer
          "Monte Carlo Simulation" card without a second card language.
          All labels, values, formats, trends, and subtitles preserved. */}
      <div className="grid grid-cols-2 gap-3 pb-4 md:grid-cols-4 md:gap-4">
        <MetricCard
          title="VaR (95%)"
          value={data.var_pct}
          format="percent"
          decimals={2}
          trend="down"
          subtitle={`${formatCurrency(data.var)}`}
          size="micro"
          mono
        />
        <MetricCard
          title="CVaR (95%)"
          value={data.cvar_pct}
          format="percent"
          decimals={2}
          trend="down"
          subtitle={`${formatCurrency(data.cvar)}`}
          size="micro"
          mono
        />
        <MetricCard
          title="Mean Final Value"
          value={data.mean_final_value}
          format="currency"
          decimals={2}
          trend={data.mean_final_value > data.current_value ? 'up' : 'down'}
          subtitle={`Current: ${formatCurrency(data.current_value)}`}
          size="micro"
          mono
        />
        <MetricCard
          title="Prob. of Loss"
          value={data.prob_loss * 100}
          format="percent"
          decimals={2}
          trend={data.prob_loss > 0.5 ? 'down' : 'up'}
          subtitle={`Prob. Gain: ${formatPercent(data.prob_gain * 100)}`}
          size="micro"
          mono
        />
      </div>

      {lastUpdated && (
        <div className="pb-4 text-right text-xs text-muted-foreground">
          Updated {formatRelativeTime(lastUpdated)}
        </div>
      )}

      {/* TEMPORARY Phase-3B proof control — NOT product UI. Exists only
          to make the registry-selected density renderer reachable for
          development validation; removed when the real switcher lands. */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground" aria-label="Temporary distribution view proof control">
        <span className="font-mono uppercase tracking-[0.14em]">Temp 3B proof</span>
        {TERMINAL_DISTRIBUTION_REGISTRY.viewIds.map((id) => (
          <Button
            key={id}
            type="button"
            variant={proofViewId === id ? 'default' : 'outline'}
            size="sm"
            onClick={() => setProofViewId(id)}
            aria-pressed={proofViewId === id}
          >
            {TERMINAL_DISTRIBUTION_REGISTRY.views[id].label}
          </Button>
        ))}
      </div>

      {/* Fan Chart + Histogram */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Fan Chart */}
        <div className="sentinel-card min-w-0 overflow-hidden">
          <div className="border-b border-[rgba(167,139,250,0.16)] p-4">
            <p className="eyebrow">Projection</p>
            <h4 className="mt-1 font-semibold text-foreground">Simulated Portfolio Paths (Fan Chart)</h4>
            <p className="text-sm text-muted-foreground">
              {paths.length} paths · {days} days · 90% confidence band
            </p>
          </div>
          <div className="h-[300px] p-4 sm:h-[350px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={percentileData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 10, fill: CHART.tick }}
                  tickFormatter={(v) => `Day ${v}`}
                  interval={Math.max(1, Math.floor(days / 10))}
                  minTickGap={24}
                  tickLine={false}
                  axisLine={{ stroke: CHART.grid }}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: CHART.tick }}
                  tickFormatter={yTickFormatter}
                  width={64}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  labelStyle={{ color: '#F8FAFC' }}
                  formatter={(value: number, name: string) => [formatCurrency(value), name]}
                  labelFormatter={(day) => `Day ${day}`}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: CHART.tick }} />
                {/* Invisible stacking base at p5 (hidden from legend + tooltip) */}
                <Area
                  type="monotone"
                  dataKey="p5"
                  stackId="fan"
                  stroke="none"
                  fill="transparent"
                  legendType="none"
                  tooltipType="none"
                  name="p5 base"
                />
                <Area
                  type="monotone"
                  dataKey="bandOuterLow"
                  stackId="fan"
                  stroke={CHART.bandOuterStroke}
                  strokeWidth={1}
                  fill={CHART.bandOuter}
                  name="5–25th pct"
                  tooltipType="none"
                />
                <Area
                  type="monotone"
                  dataKey="bandInnerLow"
                  stackId="fan"
                  stroke={CHART.bandInnerLowStroke}
                  strokeWidth={1}
                  fill={CHART.bandInnerLow}
                  name="25–50th pct"
                  tooltipType="none"
                />
                <Area
                  type="monotone"
                  dataKey="bandInnerHigh"
                  stackId="fan"
                  stroke={CHART.bandInnerHighStroke}
                  strokeWidth={1}
                  fill={CHART.bandInnerHigh}
                  name="50–75th pct"
                  tooltipType="none"
                />
                <Area
                  type="monotone"
                  dataKey="bandOuterHigh"
                  stackId="fan"
                  stroke={CHART.bandOuterStroke}
                  strokeWidth={1}
                  fill={CHART.bandOuter}
                  name="75–95th pct"
                  tooltipType="none"
                />
                <Line
                  type="monotone"
                  dataKey="p50"
                  stroke={CHART.median}
                  strokeWidth={2}
                  dot={false}
                  name="Median"
                />
                <ReferenceLine
                  y={varThreshold}
                  stroke={CHART.varThreshold}
                  strokeWidth={1}
                  strokeDasharray="5 5"
                  label={{ value: 'VaR Threshold', position: 'insideTopRight', fontSize: 10, fill: CHART.varThreshold }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Terminal distribution — renderer-selection boundary. The
            resolved definition picks the renderer; no scattered view
            checks exist elsewhere. Fan chart above is untouched. */}
        {distributionView.rendererId === 'histogram' && distribution && (
          <TerminalHistogram data={distribution} />
        )}
        {distributionView.rendererId === 'density' && distribution && (
          <TerminalDensity data={distribution} />
        )}
      </div>

      {/* Percentile Table — P1: canonical V2-Metric micro + mono (no
          bespoke PercentileCard). Labels, values, and confidence context
          preserved; the loss-tail tile keeps the approved semantic
          danger treatment (`!` guarantees the tone wins over the base
          card surface). */}
      <div className="pt-4">
        <p className="eyebrow mb-3">Key Percentiles (Final Portfolio Value)</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5 md:gap-4">
          {[
            { label: '5th Percentile (VaR)', value: data.percentiles.p5, isTail: true },
            { label: '25th Percentile', value: data.percentiles.p25, isTail: false },
            { label: 'Median (50th)', value: data.percentiles.p50, isTail: false },
            { label: '75th Percentile', value: data.percentiles.p75, isTail: false },
            { label: '95th Percentile', value: data.percentiles.p95, isTail: false },
          ].map((item) => (
            <MetricCard
              key={item.label}
              title={item.label}
              value={item.value}
              format="currency"
              decimals={2}
              size="micro"
              mono
              className={item.isTail ? '!border-red-500/25 !bg-red-500/[0.07]' : undefined}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
