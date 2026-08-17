'use client';

import { useState, useEffect } from 'react';
import { cn, formatRelativeTime } from '@/lib/utils';
import { useHealth } from '@/hooks/useApi';
import { useRiskScore } from '@/hooks/useApi';
import { useRouter, useParams } from 'next/navigation';

interface StatusBarProps {
  position?: 'top' | 'bottom';
  className?: string;
}

export function StatusBar({ position = 'bottom', className }: StatusBarProps) {
  const { data: health, isLoading: healthLoading } = useHealth();
  const router = useRouter();
  const params = useParams();
  const portfolioId = params?.id ? parseInt(params.id as string, 10) : null;
  
  const { data: riskScore, isLoading: scoreLoading } = useRiskScore(portfolioId);
  
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  // Update refresh time when health check succeeds
  useEffect(() => {
    if (health && !healthLoading) {
      setLastRefresh(new Date());
    }
  }, [health, healthLoading]);

  const getHealthStatus = () => {
    if (healthLoading) return 'checking';
    if (health?.status === 'healthy' && health?.database === 'connected') return 'live';
    return 'offline';
  };

  const healthStatus = getHealthStatus();

  const getHealthColor = (status: string) => {
    switch (status) {
      case 'live': return 'text-green-400';
      case 'checking': return 'text-amber-400';
      default: return 'text-red-400';
    }
  };

  const getHealthLabel = (status: string) => {
    switch (status) {
      case 'live': return 'LIVE';
      case 'checking': return 'CHECKING';
      default: return 'OFFLINE';
    }
  };

  const getRiskScoreColor = (score: number) => {
    if (score <= 30) return 'text-green-400 bg-green-500/10';
    if (score <= 60) return 'text-amber-400 bg-amber-500/10';
    return 'text-red-400 bg-red-500/10';
  };

  const positionClasses = position === 'top'
    ? 'fixed top-0 left-0 right-0 z-40 border-b'
    : 'fixed bottom-0 left-0 right-0 z-40 border-t';

  return (
    <div className={cn(
      'bg-background/95 backdrop-blur-sm border-muted/30',
      positionClasses,
      className
    )}>
      <div className="flex items-center justify-between px-4 py-1.5 text-xs">
        {/* Left: Health Status */}
        <div className="flex items-center gap-2">
          <span className={cn('font-mono font-medium', getHealthColor(healthStatus))}>
            {getHealthLabel(healthStatus)}
          </span>
          <span className="text-muted-foreground">API</span>
          {health && !healthLoading && (
            <>
              <span className="text-muted-foreground">•</span>
              <span className="text-muted-foreground">
                DB: {health.database}
              </span>
            </>
          )}
        </div>

        {/* Center: Last Refresh */}
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>Last refresh: {formatRelativeTime(lastRefresh)}</span>
        </div>

        {/* Right: Risk Score (only on portfolio pages) */}
        {portfolioId && (
          <div className="flex items-center gap-2">
            {scoreLoading ? (
              <span className="text-muted-foreground">Risk: —</span>
            ) : riskScore ? (
              <span className={cn(
                'px-2 py-0.5 rounded font-mono font-medium',
                getRiskScoreColor(riskScore.risk_score)
              )}>
                Risk: {riskScore.risk_score}/100
              </span>
            ) : (
              <span className="text-muted-foreground">Risk: N/A</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}