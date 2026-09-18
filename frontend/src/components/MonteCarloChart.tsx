'use client';

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
  BarChart,
  Bar,
  Cell,
  ReferenceLine,
} from 'recharts';
import { cn } from '@/lib/utils';
import { formatCurrency, formatPercent, formatNumber, formatRelativeTime } from '@/lib/utils';

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
  if (isLoading) {
    return (
      <div className="rounded-lg border bg-card p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-muted rounded w-1/4" />
          <div className="h-64 bg-muted rounded" />
          <div className="h-64 bg-muted rounded" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border bg-card p-6 text-center">
        <p className="text-destructive mb-2">Failed to load Monte Carlo data</p>
        <p className="text-sm text-muted-foreground mb-4">{error}</p>
        <button 
          className="text-sm text-primary hover:underline"
          onClick={() => onRetry?.()}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data || !data.simulated_paths_sample?.length) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center">
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

  const finalValues = paths.map((p) => p[days - 1]);
  const minVal = Math.min(...finalValues);
  const maxVal = Math.max(...finalValues);
  const binCount = 30;
  const binWidth = (maxVal - minVal) / binCount;

  const histogramBins = [];
  for (let i = 0; i < binCount; i++) {
    const binStart = minVal + i * binWidth;
    const binEnd = binStart + binWidth;
    const count = finalValues.filter((v) => v >= binStart && v < binEnd).length;
    const isTail = binEnd <= data.current_value - data.var;
    histogramBins.push({
      range: `${binStart.toFixed(0)}-${binEnd.toFixed(0)}`,
      count,
      isTail,
    });
  }

  const varThreshold = data.current_value - data.var;

  // Adaptive Y-axis labels: $k shorthand only when values are large enough
  // for it to stay readable; otherwise show full dollar amounts.
  const yTickFormatter = (v: number) =>
    Math.abs(maxVal) >= 10000 ? `$${(v / 1000).toFixed(0)}k` : `$${Math.round(v).toLocaleString()}`;

  return (
    // Content-only: embedded inside an outer Card that already provides the
    // "Monte Carlo Simulation" title, so no duplicate card chrome here.
    <div className="min-w-0">
      {/* Metric Cards */}
      <div className="grid grid-cols-2 gap-3 pb-4 md:grid-cols-4 md:gap-4">
        <MetricCard
          title="VaR (95%)"
          value={data.var_pct}
          format="percent"
          trend="down"
          subtitle={`${formatCurrency(data.var)}`}
        />
        <MetricCard
          title="CVaR (95%)"
          value={data.cvar_pct}
          format="percent"
          trend="down"
          subtitle={`${formatCurrency(data.cvar)}`}
        />
        <MetricCard
          title="Mean Final Value"
          value={data.mean_final_value}
          format="currency"
          trend={data.mean_final_value > data.current_value ? 'up' : 'down'}
          subtitle={`Current: ${formatCurrency(data.current_value)}`}
        />
        <MetricCard
          title="Prob. of Loss"
          value={data.prob_loss * 100}
          format="percent"
          trend={data.prob_loss > 0.5 ? 'down' : 'up'}
          subtitle={`Prob. Gain: ${formatPercent(data.prob_gain * 100)}`}
        />
      </div>

      {lastUpdated && (
        <div className="pb-4 text-right text-xs text-muted-foreground">
          Updated {formatRelativeTime(lastUpdated)}
        </div>
      )}

      {/* Fan Chart + Histogram */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Fan Chart */}
        <div className="min-w-0 rounded-lg border border-border/50 bg-card">
          <div className="border-b p-4">
            <h4 className="font-semibold">Simulated Portfolio Paths (Fan Chart)</h4>
            <p className="text-sm text-muted-foreground">
              {paths.length} paths · {days} days · 90% confidence band
            </p>
          </div>
          <div className="h-[300px] p-4 sm:h-[350px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={percentileData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => `Day ${v}`}
                  interval={Math.max(1, Math.floor(days / 10))}
                  minTickGap={24}
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  tickFormatter={yTickFormatter}
                  width={64}
                />
                <Tooltip
                  formatter={(value: number, name: string) => [formatCurrency(value), name]}
                  labelFormatter={(day) => `Day ${day}`}
                />
                <Legend />
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
                  stroke="rgba(59, 130, 246, 0.4)"
                  strokeWidth={1}
                  fill="rgba(59, 130, 246, 0.12)"
                  name="5–25th pct"
                  tooltipType="none"
                />
                <Area
                  type="monotone"
                  dataKey="bandInnerLow"
                  stackId="fan"
                  stroke="rgba(59, 130, 246, 0.5)"
                  strokeWidth={1}
                  fill="rgba(59, 130, 246, 0.25)"
                  name="25–50th pct"
                  tooltipType="none"
                />
                <Area
                  type="monotone"
                  dataKey="bandInnerHigh"
                  stackId="fan"
                  stroke="rgba(239, 68, 68, 0.5)"
                  strokeWidth={1}
                  fill="rgba(239, 68, 68, 0.22)"
                  name="50–75th pct"
                  tooltipType="none"
                />
                <Area
                  type="monotone"
                  dataKey="bandOuterHigh"
                  stackId="fan"
                  stroke="rgba(239, 68, 68, 0.4)"
                  strokeWidth={1}
                  fill="rgba(239, 68, 68, 0.10)"
                  name="75–95th pct"
                  tooltipType="none"
                />
                <Line
                  type="monotone"
                  dataKey="p50"
                  stroke="#22d3ee"
                  strokeWidth={2}
                  dot={false}
                  name="Median"
                />
                <ReferenceLine
                  y={varThreshold}
                  stroke="#f97316"
                  strokeWidth={1}
                  strokeDasharray="5 5"
                  label={{ value: 'VaR Threshold', position: 'insideTopRight', fontSize: 10, fill: '#f97316' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Histogram */}
        <div className="min-w-0 rounded-lg border border-border/50 bg-card">
          <div className="border-b p-4">
            <h4 className="font-semibold">Final Value Distribution</h4>
            <p className="text-sm text-muted-foreground">
              {finalValues.length} simulations · VaR threshold marked
            </p>
          </div>
          <div className="h-[300px] p-4 sm:h-[350px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={histogramBins} layout="vertical" margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} vertical={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => v.toLocaleString()} />
                <YAxis
                  type="category"
                  dataKey="range"
                  tick={{ fontSize: 9 }}
                  width={88}
                  tickLine={false}
                  axisLine={false}
                  interval={2}
                />
                <Tooltip
                  formatter={(value: number, name: string) => [value.toLocaleString(), name]}
                  labelFormatter={(range) => `Final Value: ${range}`}
                />
                <Bar
                  dataKey="count"
                  radius={[0, 4, 4, 0]}
                  name="Frequency"
                >
                  {histogramBins.map((bin, index) => (
                    <Cell
                      key={index}
                      fill={bin.isTail ? 'rgba(239, 68, 68, 0.7)' : 'rgba(59, 130, 246, 0.6)'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-border/50 bg-muted/30 p-4 text-xs">
            <div className="flex items-center gap-1">
              <span className="h-3 w-3 rounded" style={{ backgroundColor: 'rgba(239, 68, 68, 0.7)' }}></span>
              <span>Loss Tail (VaR)</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="h-3 w-3 rounded" style={{ backgroundColor: 'rgba(59, 130, 246, 0.6)' }}></span>
              <span>Gain/Neutral</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="h-2 w-2 rounded" style={{ backgroundColor: '#f97316' }}></span>
              <span>VaR: {formatCurrency(varThreshold)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Percentile Table */}
      <div className="pt-4">
        <h4 className="mb-3 font-semibold">Key Percentiles (Final Portfolio Value)</h4>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5 md:gap-4">
          {[
            { label: '5th Percentile (VaR)', value: data.percentiles.p5, isTail: true },
            { label: '25th Percentile', value: data.percentiles.p25, isTail: false },
            { label: 'Median (50th)', value: data.percentiles.p50, isTail: false },
            { label: '75th Percentile', value: data.percentiles.p75, isTail: false },
            { label: '95th Percentile', value: data.percentiles.p95, isTail: false },
          ].map((item) => (
            <div
              key={item.label}
              className={cn(
                'rounded-lg border p-4 text-center',
                item.isTail ? 'border-red-500/20 bg-red-500/10' : 'border-border/50 bg-muted/30'
              )}
            >
              <p className="text-xs text-muted-foreground mb-1">{item.label}</p>
              <p className="font-mono font-bold text-lg">
                {formatCurrency(item.value)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Helper MetricCard component
function MetricCard({
  title,
  value,
  format = 'number',
  subtitle,
  trend,
}: {
  title: string;
  value: number;
  format?: 'currency' | 'percent' | 'number';
  subtitle?: string;
  trend: 'up' | 'down' | 'neutral';
}) {
  const formattedValue = format === 'currency'
    ? formatCurrency(value)
    : format === 'percent'
      ? `${value.toFixed(2)}%`
      : formatNumber(value);
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{title}</p>
      <p className="text-2xl font-bold font-mono mt-1">{formattedValue}</p>
      {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
    </div>
  );
}