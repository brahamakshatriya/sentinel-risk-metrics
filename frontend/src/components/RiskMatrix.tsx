'use client';

import { useRef, useEffect, useState } from 'react';
import { cn, formatPercent } from '@/lib/utils';
import type { HoldingRiskPoint } from '@/types/api';

interface RiskMatrixProps {
  data: HoldingRiskPoint[];
  isLoading?: boolean;
  error?: string | null;
  className?: string;
  onRetry?: () => void;
}

export function RiskMatrix({ data, isLoading, error, className, onRetry }: RiskMatrixProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const resize = () => {
      if (canvasRef.current) {
        const parent = canvasRef.current.parentElement;
        if (parent) {
          setDimensions({
            width: parent.clientWidth,
            height: parent.clientHeight || 300,
          });
        }
      }
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  useEffect(() => {
    if (!canvasRef.current || !dimensions.width) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    const { width, height } = dimensions;
    const dpr = window.devicePixelRatio || 1;
    canvasRef.current.width = width * dpr;
    canvasRef.current.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.clearRect(0, 0, width, height);

    if (!data.length) return;

    // Calculate scales
    const padding = 50;
    const plotWidth = width - 2 * padding;
    const plotHeight = height - 2 * padding;

    const volatilities = data.map(d => d.volatility);
    const compVars = data.map(d => d.component_var);
    
    const minVol = Math.min(...volatilities);
    const maxVol = Math.max(...volatilities);
    const minCompVar = Math.min(...compVars);
    const maxCompVar = Math.max(...compVars);

    const volRange = maxVol - minVol || 1;
    const compVarRange = maxCompVar - minCompVar || 1;

    const xScale = (v: number) => padding + ((v - minVol) / volRange) * plotWidth;
    const yScale = (v: number) => height - padding - ((v - minCompVar) / compVarRange) * plotHeight;

    // Draw axes
    ctx.strokeStyle = 'rgba(167,139,250,0.3)'; // lavender edge
    ctx.lineWidth = 1;
    
    // X axis
    ctx.beginPath();
    ctx.moveTo(padding, height - padding);
    ctx.lineTo(width - padding, height - padding);
    ctx.stroke();
    
    // Y axis
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, height - padding);
    ctx.stroke();

    // Axis labels
    ctx.fillStyle = '#94A3B8'; // sentinel muted
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Volatility (Annualized)', width / 2, height - 10);
    
    ctx.save();
    ctx.translate(15, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Component VaR (Risk Contribution)', 0, 0);
    ctx.restore();

    // Grid lines
    ctx.strokeStyle = 'rgba(167,139,250,0.12)'; // restrained violet grid
    ctx.lineWidth = 0.5;
    
    // Vertical grid lines
    for (let i = 0; i <= 5; i++) {
      const x = padding + (i / 5) * plotWidth;
      ctx.beginPath();
      ctx.moveTo(x, padding);
      ctx.lineTo(x, height - padding);
      ctx.stroke();
      
      const val = minVol + (i / 5) * (maxVol - minVol);
      ctx.fillStyle = '#94A3B8';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText((val * 100).toFixed(1) + '%', x, height - padding + 18);
    }
    
    // Horizontal grid lines
    for (let i = 0; i <= 5; i++) {
      const y = height - padding - (i / 5) * plotHeight;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();
      
      const val = minCompVar + (i / 5) * (maxCompVar - minCompVar);
      ctx.fillStyle = '#94A3B8';
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(val.toFixed(4), padding - 8, y + 3);
    }

    // Quadrant labels (optional)
    ctx.fillStyle = 'rgba(148,163,184,0.5)';
    ctx.font = '10px monospace';
    ctx.fillText('High Risk / High Contribution', width - padding - 100, padding + 20);
    ctx.fillText('Low Risk / High Contribution', padding + 10, padding + 20);
    ctx.fillText('Low Risk / Low Contribution', padding + 10, height - padding - 10);
    ctx.fillText('High Risk / Low Contribution', width - padding - 100, height - padding - 10);

    // Plot points
    data.forEach((point, index) => {
      const x = xScale(point.volatility);
      const y = yScale(point.component_var);
      const radius = Math.max(8, Math.min(20, point.weight * 100)); // Size by weight

      // Determine color based on risk quadrant
      const isHighVol = point.volatility > (minVol + maxVol) / 2;
      const isHighCompVar = point.component_var > (minCompVar + maxCompVar) / 2;
      
      let fillColor = '#22D3EE'; // cyan - low risk / analytical
      if (isHighVol && isHighCompVar) fillColor = '#EF4444'; // controlled red - high risk
      else if (isHighVol) fillColor = '#A78BFA'; // lavender - high vol
      else if (isHighCompVar) fillColor = '#F59E0B'; // amber - high contrib

      // Draw point
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = fillColor + 'CC';
      ctx.fill();
      ctx.strokeStyle = fillColor;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Label
      ctx.fillStyle = '#F8FAFC';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(point.symbol, x, y - radius - 4);
    });

    // Legend
    const legendItems = [
      { color: '#EF4444', label: 'High Risk / High Contribution' },
      { color: '#A78BFA', label: 'High Volatility' },
      { color: '#F59E0B', label: 'High Contribution' },
      { color: '#22D3EE', label: 'Low Risk' },
    ];

    let legendX = width - padding - 180;
    let legendY = padding + 10;
    legendItems.forEach(item => {
      ctx.fillStyle = item.color + 'CC';
      ctx.beginPath();
      ctx.arc(legendX + 8, legendY + 6, 6, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.fillStyle = '#F8FAFC';
      ctx.font = '10px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(item.label, legendX + 20, legendY + 10);
      legendY += 20;
    });
  }, [data, dimensions]);

  if (isLoading) {
    return (
      <div className={cn('rounded-lg border bg-card p-6', className)}>
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-muted rounded w-1/4" />
          <div className="aspect-square bg-muted rounded" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('sentinel-card p-6 text-center', className)} role="alert">
        <p className="text-red-300 font-medium mb-2">Failed to load risk matrix</p>
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

  return (
    <div className={cn('sentinel-card relative overflow-hidden', className)}>
      <div className="border-b border-[rgba(167,139,250,0.16)] p-4 sm:p-5">
        <p className="eyebrow">Risk decomposition</p>
        <h3 className="sentinel-section-title mt-1">Risk Matrix</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Volatility (x) vs Component VaR (y) — bubble size = portfolio weight
        </p>
      </div>
      <div className="p-2" style={{ height: 350 }}>
        <canvas ref={canvasRef} className="w-full h-full" role="img" aria-label="Risk matrix scatter plot of volatility versus component VaR" />
      </div>
    </div>
  );
}