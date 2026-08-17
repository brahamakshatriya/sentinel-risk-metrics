'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { cn, formatCurrency, formatPercent } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Separator } from '@/components/ui/Separator';

interface MonteCarloControlsProps {
  portfolioId: number;
  currentValue: number;
  currentVar95: number;
  onRun: (params: {
    lookback_days: number;
    num_simulations: number;
    horizon_days: number;
    confidence_level: number;
  }) => Promise<void>;
  isRunning: boolean;
  defaultParams?: {
    lookback_days: number;
    num_simulations: number;
    horizon_days: number;
    confidence_level: number;
  };
}

export function MonteCarloControls({ 
  portfolioId, 
  currentValue, 
  currentVar95, 
  onRun, 
  isRunning,
  defaultParams
}: MonteCarloControlsProps) {
  const [params, setParams] = useState({
    lookback_days: defaultParams?.lookback_days ?? 252,
    num_simulations: defaultParams?.num_simulations ?? 5000,
    horizon_days: defaultParams?.horizon_days ?? 252,
    confidence_level: defaultParams?.confidence_level ?? 0.95,
  });

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm({
    defaultValues: params,
  });

  const watchedParams = watch();

  // Update internal state when watched params change
  useEffect(() => {
    setParams(watchedParams);
  }, [watchedParams]);

  const handleSubmitForm = async (data: typeof params) => {
    await onRun(data);
  };

  const estimatedTime = Math.round((params.num_simulations / 1000) * (params.horizon_days / 252) * 2);
  
  // Summary text
  const summaryParts = [
    `${params.num_simulations.toLocaleString()} simulations`,
    `${params.horizon_days} trading days (${Math.round(params.horizon_days / 252)} year${params.horizon_days !== 252 ? 's' : ''})`,
    `${(params.confidence_level * 100).toFixed(0)}% confidence`,
    `${params.lookback_days} days lookback`,
  ];

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Monte Carlo Controls</CardTitle>
        <CardDescription>
          Configure and run forward-looking risk simulation. Live summary updates as you adjust.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(handleSubmitForm)} className="space-y-6">
          {/* Live Summary */}
          <div className="p-4 rounded-lg bg-muted/30 border">
            <div className="font-medium mb-2">Simulation Summary</div>
            <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
              {summaryParts.map((part, i) => (
                <Badge key={i} variant="outline" className="gap-1">
                  {part}
                </Badge>
              ))}
              <Badge variant="secondary" className="ml-2">
                ~{estimatedTime}s est.
              </Badge>
            </div>
          </div>

          <Separator />

          {/* Parameters Grid */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {/* Lookback Days */}
            <div className="space-y-2">
              <Label htmlFor="lookback_days">Lookback Days</Label>
              <div className="relative">
                <Input
                  id="lookback_days"
                  type="number"
                  min="30"
                  max="2520"
                  step="30"
                  {...register('lookback_days', { 
                    required: 'Required',
                    min: { value: 30, message: 'Min 30 days' },
                    max: { value: 2520, message: 'Max 10 years' },
                  })}
                  disabled={isRunning}
                  className="pr-10"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">days</span>
              </div>
              <input
                type="range"
                min="30"
                max="2520"
                step="30"
                {...register('lookback_days')}
                disabled={isRunning}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground">
                {params.lookback_days} days ({Math.round(params.lookback_days / 252)} year{params.lookback_days !== 252 ? 's' : ''})
              </p>
            </div>

            {/* Number of Simulations */}
            <div className="space-y-2">
              <Label htmlFor="num_simulations">Simulations</Label>
              <div className="relative">
                <Input
                  id="num_simulations"
                  type="number"
                  min="100"
                  max="20000"
                  step="500"
                  {...register('num_simulations', { 
                    required: 'Required',
                    min: { value: 100, message: 'Min 100' },
                    max: { value: 20000, message: 'Max 20,000' },
                  })}
                  disabled={isRunning}
                  className="pr-10"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">paths</span>
              </div>
              <input
                type="range"
                min="100"
                max="20000"
                step="500"
                {...register('num_simulations')}
                disabled={isRunning}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground">
                {params.num_simulations.toLocaleString()} simulation paths
              </p>
            </div>

            {/* Horizon Days */}
            <div className="space-y-2">
              <Label htmlFor="horizon_days">Horizon (Days)</Label>
              <div className="relative">
                <Input
                  id="horizon_days"
                  type="number"
                  min="1"
                  max="1260"
                  step="21"
                  {...register('horizon_days', { 
                    required: 'Required',
                    min: { value: 1, message: 'Min 1 day' },
                    max: { value: 1260, message: 'Max 5 years' },
                  })}
                  disabled={isRunning}
                  className="pr-10"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">days</span>
              </div>
              <input
                type="range"
                min="1"
                max="1260"
                step="21"
                {...register('horizon_days')}
                disabled={isRunning}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground">
                {params.horizon_days} days ({Math.round(params.horizon_days / 21)} month{params.horizon_days !== 21 ? 's' : ''})
              </p>
            </div>

            {/* Confidence Level */}
            <div className="space-y-2">
              <Label>Confidence Level</Label>
              <div className="flex gap-2">
                {[
                  { value: 0.90, label: '90%' },
                  { value: 0.95, label: '95%' },
                  { value: 0.99, label: '99%' },
                ].map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setParams(prev => ({ ...prev, confidence_level: value }))}
                    disabled={isRunning}
                    className={cn(
                      'flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors',
                      params.confidence_level === value
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-muted hover:bg-muted/50 border-muted-foreground/20'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {(params.confidence_level * 100).toFixed(0)}% VaR / CVaR
              </p>
            </div>
          </div>

          <Separator />

          {/* Current Metrics Reference */}
          <div className="p-4 rounded-lg bg-muted/30 border">
            <div className="font-medium mb-3">Current Portfolio Reference</div>
            <div className="grid gap-3 md:grid-cols-3 text-sm">
              <div className="p-2 rounded bg-card border">
                <div className="text-muted-foreground text-xs">Current Value</div>
                <div className="font-mono font-medium">{formatCurrency(currentValue)}</div>
              </div>
              <div className="p-2 rounded bg-card border">
                <div className="text-muted-foreground text-xs">Current VaR (95%)</div>
                <div className="font-mono font-medium text-destructive">
                  {formatPercent(currentVar95 * 100)}
                </div>
              </div>
              <div className="p-2 rounded bg-card border">
                <div className="text-muted-foreground text-xs">Portfolio ID</div>
                <div className="font-mono font-medium">{portfolioId}</div>
              </div>
            </div>
          </div>

          <Separator />

          {/* Run Button */}
          <Button 
            type="submit" 
            disabled={isRunning}
            className="w-full py-3 text-lg"
            size="lg"
          >
            {isRunning ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Running {params.num_simulations.toLocaleString()} simulations...
              </span>
            ) : (
              'Run Monte Carlo Simulation'
            )}
          </Button>

          {errors.lookback_days && (
            <p className="text-sm text-red-400">{errors.lookback_days.message}</p>
          )}
          {errors.num_simulations && (
            <p className="text-sm text-red-400">{errors.num_simulations.message}</p>
          )}
          {errors.horizon_days && (
            <p className="text-sm text-red-400">{errors.horizon_days.message}</p>
          )}
          {errors.confidence_level && (
            <p className="text-sm text-red-400">{errors.confidence_level.message}</p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}