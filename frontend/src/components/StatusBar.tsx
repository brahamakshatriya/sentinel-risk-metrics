'use client';

import { useState, useEffect } from 'react';
import { cn, formatRelativeTime } from '@/lib/utils';
import { useHealth } from '@/hooks/useApi';
import { useRiskScore } from '@/hooks/useApi';
import type { ApiRequestError } from '@/lib/api';
import { useRouter, useParams } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import { LiquidGlass } from '@/components/ui/LiquidGlass';

interface StatusBarProps {
  position?: 'top' | 'bottom';
  className?: string;
}

export function StatusBar({ position = 'bottom', className }: StatusBarProps) {
  const { data: health, isLoading: healthLoading, error: healthError } = useHealth();
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

  // Health states:
  // - 'live': backend responded healthy (unchanged behavior).
  // - 'checking': first check still in flight (unchanged behavior).
  // - 'offline': the backend actually responded with an HTTP error (e.g. 5xx)
  //   or returned an unhealthy payload — a genuine backend failure.
  // - 'unknown': the request never received an HTTP response
  //   (client-side blocking such as net::ERR_BLOCKED_BY_CLIENT, DNS, CORS,
  //   or the machine being offline). The browser exposes all of these as an
  //   identical opaque network error, so they cannot be reliably told apart;
  //   claiming OFFLINE here would be false when the backend is healthy.
  type HealthStatus = 'live' | 'checking' | 'offline' | 'unknown';

  const getHealthStatus = (): HealthStatus => {
    if (healthLoading) return 'checking';
    if (health?.status === 'healthy' && health?.database === 'connected') return 'live';
    const apiError = healthError as ApiRequestError | null | undefined;
    if (apiError) {
      // Genuine backend failure: the server actually responded with HTTP 4xx/5xx.
      if (apiError.status !== undefined) return 'offline';
      // No HTTP response was ever received (client-side blocking such as
      // net::ERR_BLOCKED_BY_CLIENT, DNS, CORS, or machine offline).
      return 'unknown';
    }
    return 'offline';
  };

  const healthStatus = getHealthStatus();

  const getHealthColor = (status: string) => {
    switch (status) {
      case 'live': return 'text-green-400';
      case 'checking': return 'text-amber-400';
      case 'unknown': return 'text-slate-400';
      default: return 'text-red-400';
    }
  };

  const getHealthLabel = (status: string) => {
    switch (status) {
      case 'live': return 'LIVE';
      case 'checking': return 'CHECKING';
      case 'unknown': return 'UNKNOWN';
      default: return 'OFFLINE';
    }
  };

  const getHealthTitle = (status: string) => {
    switch (status) {
      case 'unknown':
        return 'API health check did not receive a response (e.g. blocked by a browser extension or ad-blocker). Backend status could not be determined.';
      case 'offline':
        return 'API health check failed. The backend is unreachable or reported an error.';
      default:
        return undefined;
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
    <LiquidGlass intensity="subtle" animated={false} highlight={true} className={cn(positionClasses, 'px-4 py-1.5', className)}>
      <div className="flex items-center justify-between text-xs">
        {/* Left: Health Status */}
        <div className="flex items-center gap-2">
          <span className={cn('font-mono font-medium', getHealthColor(healthStatus))} title={getHealthTitle(healthStatus)}>
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

        {/* Right: Risk Score (only on portfolio pages) + UserButton */}
        <div className="flex items-center gap-2">
          {portfolioId && (
            <>
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
              <span className="text-muted-foreground">•</span>
            </>
          )}
          <UserButton afterSignOutUrl="/" />
        </div>
      </div>
    </LiquidGlass>
  );
}