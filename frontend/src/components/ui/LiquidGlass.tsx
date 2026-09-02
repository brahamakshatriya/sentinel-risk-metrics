'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

interface LiquidGlassProps {
  children: React.ReactNode;
  className?: string;
  intensity?: 'subtle' | 'medium' | 'strong';
  animated?: boolean;
  highlight?: boolean;
  fallback?: boolean;
}

const filterIds = {
  subtle: 'liquid-glass-subtle',
  medium: 'liquid-glass-medium',
  strong: 'liquid-glass-strong',
};

export function LiquidGlass({ 
  children, 
  className, 
  intensity = 'medium', 
  animated = true, 
  highlight = true,
  fallback = false 
}: LiquidGlassProps) {
  const filterId = filterIds[intensity];
  const [supportsFilter, setSupportsFilter] = React.useState(true);

  React.useEffect(() => {
    const testEl = document.createElement('div');
    testEl.style.filter = `url(#${filterId})`;
    const hasSupport = testEl.style.filter !== '';
    setSupportsFilter(hasSupport);
  }, [filterId]);

  const useFallback = fallback || !supportsFilter;

  return (
    <>
      <defs>
        <filter id={filterIds.subtle} x="-20%" y="-20%" width="140%" height="140%" filterUnits="objectBoundingBox">
          <feTurbulence 
            type="fractalNoise" 
            baseFrequency={animated ? '0.008 0.008' : '0.015 0.015'} 
            numOctaves={3} 
            result="noise"
            seed="42"
          />
          <feDisplacementMap 
            in="SourceGraphic" 
            in2="noise" 
            scale={4} 
            xChannelSelector="R" 
            yChannelSelector="G" 
            result="displaced"
          />
          <feGaussianBlur in="displaced" stdDeviation={0.5} result="blurred" />
          <feBlend in="SourceGraphic" in2="blurred" mode="normal" />
        </filter>
        
        <filter id={filterIds.medium} x="-30%" y="-30%" width="160%" height="160%" filterUnits="objectBoundingBox">
          <feTurbulence 
            type="fractalNoise" 
            baseFrequency={animated ? '0.012 0.012' : '0.025 0.025'} 
            numOctaves={4} 
            result="noise"
            seed="42"
          />
          <feDisplacementMap 
            in="SourceGraphic" 
            in2="noise" 
            scale={8} 
            xChannelSelector="R" 
            yChannelSelector="G" 
            result="displaced"
          />
          <feGaussianBlur in="displaced" stdDeviation={0.8} result="blurred" />
          <feColorMatrix in="blurred" type="saturate" values="1.1" result="saturated" />
          <feBlend in="SourceGraphic" in2="saturated" mode="normal" />
        </filter>
        
        <filter id={filterIds.strong} x="-40%" y="-40%" width="180%" height="180%" filterUnits="objectBoundingBox">
          <feTurbulence 
            type="fractalNoise" 
            baseFrequency={animated ? '0.018 0.018' : '0.04 0.04'} 
            numOctaves={5} 
            result="noise"
            seed="42"
          />
          <feDisplacementMap 
            in="SourceGraphic" 
            in2="noise" 
            scale={14} 
            xChannelSelector="R" 
            yChannelSelector="G" 
            result="displaced"
          />
          <feGaussianBlur in="displaced" stdDeviation={1.2} result="blurred" />
          <feColorMatrix in="blurred" type="saturate" values="1.2" result="saturated" />
          <feComponentTransfer in="saturated" result="brightened">
            <feFuncR type="linear" slope="1.05" intercept="0.02" />
            <feFuncG type="linear" slope="1.05" intercept="0.02" />
            <feFuncB type="linear" slope="1.05" intercept="0.02" />
          </feComponentTransfer>
          <feBlend in="SourceGraphic" in2="brightened" mode="normal" />
        </filter>

        {highlight && (
          <>
            <filter id={`liquid-highlight-${intensity}`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceAlpha" stdDeviation={intensity === 'strong' ? 3 : intensity === 'medium' ? 2 : 1.5} result="blur" />
              <feOffset dx={0} dy={-1} result="offsetBlur" />
              <feFlood flood-color="white" flood-opacity={intensity === 'strong' ? 0.18 : intensity === 'medium' ? 0.12 : 0.08} result="highlightColor" />
              <feComposite in="highlightColor" in2="offsetBlur" operator="in" result="highlight" />
              <feMerge>
                <feMergeNode in="highlight" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </>
        )}
      </defs>

      <div
        className={cn(
          'relative overflow-hidden rounded-xl',
          'bg-white/5 backdrop-blur-xl',
          'border border-white/10',
          'shadow-[0_2px_8px_-2px_rgba(0,0,0,0.3),0_8px_24px_-8px_rgba(0,0,0,0.2)]',
          'transition-all duration-300',
          'will-change-[filter,transform]',
          useFallback ? 'backdrop-blur-2xl' : `filter-[url(#${filterId})] ${highlight ? `filter-[url(#liquid-highlight-${intensity})]` : ''}`,
          className
        )}
        style={{
          isolation: 'isolate',
          transform: 'translateZ(0)',
          backfaceVisibility: 'hidden',
        } as React.CSSProperties}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-white/10 via-transparent to-white/5 pointer-events-none" />
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent pointer-events-none" />
        <div className="relative z-10">{children}</div>
      </div>
    </>
  );
}

export function LiquidGlassCard({ 
  children, 
  className, 
  intensity = 'medium',
  animated = true,
  highlight = true,
  p = 6,
  ...props 
}: LiquidGlassProps & { p?: number }) {
  return (
    <LiquidGlass intensity={intensity} animated={animated} highlight={highlight} className={cn(`p-${p}`, className)}>
      {children}
    </LiquidGlass>
  );
}

export function LiquidGlassModal({ 
  children, 
  className, 
  isOpen,
  onClose,
  intensity = 'medium',
  animated = true,
  ...props 
}: LiquidGlassProps & { 
  isOpen: boolean; 
  onClose: () => void;
  intensity?: 'subtle' | 'medium' | 'strong';
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" {...props}>
      <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" onClick={onClose} />
      <LiquidGlass 
        intensity={intensity} 
        animated={animated} 
        highlight={true}
        className={cn('w-full max-w-lg max-h-[85vh] overflow-y-auto', className)}
      >
        {children}
      </LiquidGlass>
    </div>
  );
}