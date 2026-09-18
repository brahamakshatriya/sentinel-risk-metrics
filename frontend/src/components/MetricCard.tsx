'use client';

import { cn } from '@/lib/utils';
import { formatCurrency, formatPercent } from '@/lib/utils';

interface MetricCardProps {
  title: string;
  value: number | string;
  subtitle?: string;
  trend?: 'up' | 'down' | 'neutral';
  prefix?: string;
  suffix?: string;
  decimals?: number;
  format?: 'currency' | 'percent' | 'number';
}

export function MetricCard({ 
  title, 
  value, 
  subtitle, 
  trend = 'neutral',
  prefix = '',
  suffix = '',
  decimals = 2,
  format = 'number'
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

  return (
    <div className="sentinel-card group relative overflow-hidden p-5 transition-colors duration-200 hover:border-[rgba(167,139,250,0.32)]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[rgba(167,139,250,0.4)] to-transparent"
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">{title}</p>
          <p className="metric-value mt-2 text-[clamp(1.5rem,2.5vw,2rem)] leading-none">
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