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
    up: 'text-green-400',
    down: 'text-red-400',
    neutral: 'text-muted-foreground',
  };
  
  const trendIcons = {
    up: '↑',
    down: '↓',
    neutral: '—',
  };

  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold text-foreground mt-1">
            {formattedValue}
          </p>
        </div>
        {subtitle && (
          <div className="text-right">
            <p className={`text-sm ${cn(trendColors[trend])}`}>
              {trendIcons[trend]} {subtitle}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}