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
    if (score <= 30) return 'text-green-400 bg-green-500/10 border-green-500/20';
    if (score <= 60) return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
    return 'text-red-400 bg-red-500/10 border-red-500/20';
  };

  const getBackgroundClass = (score: number) => {
    if (score <= 30) return 'from-green-500/20 to-green-600/10';
    if (score <= 60) return 'from-amber-500/20 to-amber-600/10';
    return 'from-red-500/20 to-red-600/10';
  };

  return (
    <div className={cn('relative overflow-hidden rounded-xl border p-6', getColorClass(score), className)}>
      <div className="absolute inset-0 bg-gradient-to-br opacity-50" style={{ background: getBackgroundClass(score) }} />
      <div className="relative flex flex-col items-center text-center">
        <div className="mb-2 text-xs font-medium uppercase tracking-wider opacity-70">Risk Score</div>
        <div className="text-5xl font-bold tabular-nums" style={{ fontSize: 'clamp(4rem, 12vw, 6rem)' }}>
          {score}
        </div>
        <div className="mt-2 text-sm font-medium">{label}</div>
        
        {(varComponent !== undefined || sharpeComponent !== undefined || correlationComponent !== undefined) && (
          <div className="mt-6 w-full max-w-md grid grid-cols-3 gap-4 text-left">
            {varComponent !== undefined && (
              <div className="p-3 rounded-lg bg-background/50 border">
                <div className="text-xs text-muted-foreground uppercase tracking-wider">VaR Component</div>
                <div className="text-lg font-mono font-bold mt-1">
                  {(varComponent * 100).toFixed(0)}%
                </div>
                <div className="mt-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-primary/50" 
                    style={{ width: `${varComponent * 100}%` }}
                  />
                </div>
              </div>
            )}
            {sharpeComponent !== undefined && (
              <div className="p-3 rounded-lg bg-background/50 border">
                <div className="text-xs text-muted-foreground uppercase tracking-wider">Inverse Sharpe</div>
                <div className="text-lg font-mono font-bold mt-1">
                  {(sharpeComponent * 100).toFixed(0)}%
                </div>
                <div className="mt-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-primary/50" 
                    style={{ width: `${sharpeComponent * 100}%` }}
                  />
                </div>
              </div>
            )}
            {correlationComponent !== undefined && (
              <div className="p-3 rounded-lg bg-background/50 border">
                <div className="text-xs text-muted-foreground uppercase tracking-wider">Correlation</div>
                <div className="text-lg font-mono font-bold mt-1">
                  {(correlationComponent * 100).toFixed(0)}%
                </div>
                <div className="mt-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-primary/50" 
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