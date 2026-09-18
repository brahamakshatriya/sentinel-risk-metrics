'use client';

import { cn } from '@/lib/utils';

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
  const getColorClass = (score: number) => {
    if (score <= 30) return 'text-emerald-300 border-emerald-500/25 bg-emerald-500/[0.06]';
    if (score <= 60) return 'text-amber-300 border-amber-500/25 bg-amber-500/[0.06]';
    return 'text-red-300 border-red-500/25 bg-red-500/[0.06]';
  };

  const getBackgroundClass = (score: number) => {
    if (score <= 30) return 'from-emerald-500/20 to-emerald-600/10';
    if (score <= 60) return 'from-amber-500/20 to-amber-600/10';
    return 'from-red-500/20 to-red-600/10';
  };

  return (
    <div className={cn('sentinel-card relative overflow-hidden p-6 sm:p-8', getColorClass(score), className)}>
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[rgba(167,139,250,0.45)] to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-br opacity-50" style={{ background: getBackgroundClass(score) }} />
      <div className="relative flex flex-col items-center text-center">
        <div className="eyebrow mb-2 opacity-80">Risk Score</div>
        <div className="metric-value tabular-nums text-current" style={{ fontSize: 'clamp(3.5rem, 10vw, 5.5rem)', lineHeight: 1 }}>
          {score}
        </div>
        <div className="mt-2 text-sm font-medium text-foreground">{label}</div>
        
        {(varComponent !== undefined || sharpeComponent !== undefined || correlationComponent !== undefined) && (
          <div className="mt-6 w-full max-w-md grid grid-cols-1 gap-3 text-left sm:grid-cols-3 sm:gap-4">
            {varComponent !== undefined && (
              <div className="p-3 rounded-lg bg-[#070A12]/60 border border-white/5">
                <div className="eyebrow">VaR Component</div>
                <div className="text-lg font-mono font-bold mt-1 text-foreground tabular-nums">
                  {(varComponent * 100).toFixed(0)}%
                </div>
                <div className="mt-2 h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-[#7C3AED] to-[#22D3EE]" 
                    style={{ width: `${varComponent * 100}%` }}
                  />
                </div>
              </div>
            )}
            {sharpeComponent !== undefined && (
              <div className="p-3 rounded-lg bg-[#070A12]/60 border border-white/5">
                <div className="eyebrow">Inverse Sharpe</div>
                <div className="text-lg font-mono font-bold mt-1 text-foreground tabular-nums">
                  {(sharpeComponent * 100).toFixed(0)}%
                </div>
                <div className="mt-2 h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-[#7C3AED] to-[#22D3EE]" 
                    style={{ width: `${sharpeComponent * 100}%` }}
                  />
                </div>
              </div>
            )}
            {correlationComponent !== undefined && (
              <div className="p-3 rounded-lg bg-[#070A12]/60 border border-white/5">
                <div className="eyebrow">Correlation</div>
                <div className="text-lg font-mono font-bold mt-1 text-foreground tabular-nums">
                  {(correlationComponent * 100).toFixed(0)}%
                </div>
                <div className="mt-2 h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-[#7C3AED] to-[#22D3EE]" 
                    style={{ width: `${correlationComponent * 100}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      
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
  return (
    <div className="rounded-xl border bg-muted/50 p-6 animate-pulse">
      <div className="flex flex-col items-center text-center">
        <div className="h-4 w-24 bg-muted rounded mb-2" />
        <div className="h-16 w-24 bg-muted rounded mb-2" />
        <div className="h-4 w-32 bg-muted rounded" />
        <div className="mt-6 w-full max-w-md grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-3 rounded-lg bg-muted/50 border">
              <div className="h-3 w-20 bg-muted rounded mb-1" />
              <div className="h-6 w-12 bg-muted rounded mb-1" />
              <div className="h-2 bg-muted/50 rounded-full">
                <div className="h-full bg-muted w-1/2 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}