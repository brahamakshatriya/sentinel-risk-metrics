'use client';

import { cn } from '@/lib/utils';

interface MetricCardProps {
  title: string;
  value: number | string;
  subtitle?: string;
  trend?: 'up' | 'down' | 'neutral';
  prefix?: string;
  suffix?: string;
  decimals?: number;
  format?: 'currency' | 'percent' | 'number';
  /* ——— CARD SYSTEM V2 · P0 canonical MetricCard ———
     ONE implementation for all metric surfaces (portfolio grids,
     Monte Carlo metrics, and later: minis/readouts/percentiles).
     Sizes: default (S-card p-5, grid metric) · micro (S-micro p-3,
     analytical tiles) · large (p-6, RiskScore hero only).
     Metrics are NOT interactive by default — hover affordance is
     opt-in via `interactive` (linked portfolio cards only).
     `mono` allows tabular analytical values (MC/scenario). */
  size?: 'default' | 'micro' | 'large';
  mono?: boolean;
  interactive?: boolean;
  className?: string;
}

export function MetricCard({ 
  title, 
  value, 
  subtitle, 
  trend = 'neutral',
  prefix = '',
  suffix = '',
  decimals = 2,
  format = 'number',
  size = 'default',
  mono = false,
  interactive = false,
  className,
}: MetricCardProps) {
  const numericValue = typeof value === 'string' ? parseFloat(value) : value;
  const isNaNValue = isNaN(numericValue);
  
  let formattedValue: string;
  if (format === 'currency') {
    formattedValue = `${prefix}$${isNaNValue ? '0' : numericValue.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`;
  } else if (format === 'percent') {
    formattedValue = `${prefix}${isNaNValue ? '0' : numericValue.toFixed(decimals)}%${suffix}`;
  } else {
    formattedValue = `${prefix}${isNaNValue ? '0' : numericValue.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`;
  }
  
  const trendColors = {
    up: 'text-emerald-400',
    down: 'text-red-400',
    neutral: 'text-muted-foreground',
  };
  
  const trendIcons = {
    up: '↑',
    down: '↓',
    neutral: '—',
  };

  const sizeClasses = {
    // S-card p-5 grid metric. Hairline accent, standard value scale.
    default: 'p-5',
    // S-micro p-3 analytical tile. No hairline, compact value.
    micro: 'p-3',
    // p-6 hero metric (RiskScore number). Large clamp value.
    large: 'p-6 sm:p-8',
  };

  const valueClasses = {
    default: 'mt-2 text-[clamp(1.5rem,2.5vw,2rem)] leading-none',
    micro: 'mt-1.5 text-lg leading-none',
    large: 'mt-2 leading-none tabular-nums text-current',
  };

  const valueStyle =
    size === 'large' ? { fontSize: 'clamp(2.5rem, 6vw, 3.5rem)' } : undefined;

  return (
    <div
      className={cn(
        'sentinel-card relative overflow-hidden transition-colors duration-200',
        sizeClasses[size],
        // Static metrics have no hover affordance. Only linked portfolio
        // cards opt into the interactive border.
        interactive && 'hover:border-[rgba(167,139,250,0.32)]',
        className
      )}
    >
      {size === 'default' && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[rgba(167,139,250,0.4)] to-transparent"
        />
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow truncate">{title}</p>
          <p
            className={cn('metric-value', valueClasses[size], mono && 'font-mono')}
            style={valueStyle}
          >
            {formattedValue}
          </p>
        </div>
        {subtitle && (
          <div className="shrink-0 text-right">
            <p className={`text-xs font-medium tabular-nums ${cn(trendColors[trend])}`}>
              {trendIcons[trend]} {subtitle}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}