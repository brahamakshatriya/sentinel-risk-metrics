'use client';

import { cn } from '@/lib/utils';
import { MetricCard } from '@/components/MetricCard';

interface RiskScoreProps {
  score: number;
  label: string;
  varComponent?: number;
  sharpeComponent?: number;
  correlationComponent?: number;
  className?: string;
}

export function RiskScore({ 
  score, 
  label, 
  varComponent, 
  sharpeComponent, 
  correlationComponent,
  className 
}: RiskScoreProps) {
  /* P1: hero + minis use the canonical shared MetricCard — no
     RiskScore-specific metric implementation. Semantic risk coloring
     reuses the existing tokens; `!` on border/bg guarantees the tone
     wins over the base card surface. Trend maps risk → direction:
     low risk reads "up" (emerald), high risk "down" (red). */
  const getToneClass = (score: number) => {
    if (score <= 30) return 'text-emerald-300 !border-emerald-500/25 !bg-emerald-500/[0.06]';
    if (score <= 60) return 'text-amber-300 !border-amber-500/25 !bg-amber-500/[0.06]';
    return 'text-red-300 !border-red-500/25 !bg-red-500/[0.06]';
  };

  const getTrend = (score: number): 'up' | 'down' | 'neutral' => {
    if (score <= 30) return 'up';
    if (score <= 60) return 'neutral';
    return 'down';
  };

  const components = [
    { title: 'VaR Component', value: varComponent },
    { title: 'Inverse Sharpe', value: sharpeComponent },
    { title: 'Correlation', value: correlationComponent },
  ].filter((c) => c.value !== undefined);

  return (
    <div className={cn('relative space-y-4 pb-8', className)}>
      <MetricCard
        title="Risk Score"
        value={score}
        format="number"
        decimals={0}
        trend={getTrend(score)}
        subtitle={label}
        size="large"
        className={getToneClass(score)}
      />

      {components.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          {components.map((c) => (
            <div key={c.title}>
              <MetricCard
                title={c.title}
                value={(c.value as number) * 100}
                format="percent"
                decimals={0}
                size="micro"
                mono
              />
              <div className="mt-2 h-1.5 bg-white/5 rounded-full overflow-hidden" aria-hidden="true">
                <div
                  className="h-full bg-gradient-to-r from-[#7C3AED] to-[#22D3EE]"
                  style={{ width: `${(c.value as number) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Formula tooltip */}
      <div className="absolute bottom-2 right-2 opacity-30 hover:opacity-100 transition-opacity text-xs text-right">
        <div className="font-mono text-xs">Score = 0.4×VaR + 0.3×InvSharpe + 0.3×Corr</div>
        <div className="text-xs text-muted-foreground mt-1">Illustrative metric — not an industry standard</div>
      </div>
    </div>
  );
}

interface RiskScoreSkeletonProps {
  className?: string;
}

export function RiskScoreSkeleton({ className }: RiskScoreSkeletonProps) {
  // P1: canonical state container + skeleton blocks (no bespoke shell).
  return (
    <div className={cn('sentinel-state', className)}>
      <div className="flex flex-col items-center text-center animate-pulse">
        <div className="sentinel-skeleton h-4 w-24 mb-2" />
        <div className="sentinel-skeleton h-16 w-24 mb-2" />
        <div className="sentinel-skeleton h-4 w-32" />
        <div className="mt-6 w-full grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-3 rounded-lg border border-white/5 bg-white/[0.02]">
              <div className="sentinel-skeleton h-3 w-20 mb-1" />
              <div className="sentinel-skeleton h-6 w-12 mb-1" />
              <div className="sentinel-skeleton h-1.5 w-1/2" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}