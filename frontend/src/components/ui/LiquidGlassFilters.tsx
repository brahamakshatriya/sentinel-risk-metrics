'use client';

export function LiquidGlassFilters() {
  return (
    <svg style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }} aria-hidden="true">
      <defs>
        <filter id="liquid-glass-subtle" x="-20%" y="-20%" width="140%" height="140%" filterUnits="objectBoundingBox">
          <feTurbulence type="fractalNoise" baseFrequency="0.008 0.008" numOctaves={3} result="noise" seed="42" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale={4} xChannelSelector="R" yChannelSelector="G" result="displaced" />
          <feGaussianBlur in="displaced" stdDeviation={0.5} result="blurred" />
          <feBlend in="SourceGraphic" in2="blurred" mode="normal" />
        </filter>
        
        <filter id="liquid-glass-medium" x="-30%" y="-30%" width="160%" height="160%" filterUnits="objectBoundingBox">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.012" numOctaves={4} result="noise" seed="42" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale={8} xChannelSelector="R" yChannelSelector="G" result="displaced" />
          <feGaussianBlur in="displaced" stdDeviation={0.8} result="blurred" />
          <feColorMatrix in="blurred" type="saturate" values="1.1" result="saturated" />
          <feBlend in="SourceGraphic" in2="saturated" mode="normal" />
        </filter>
        
        <filter id="liquid-glass-strong" x="-40%" y="-40%" width="180%" height="180%" filterUnits="objectBoundingBox">
          <feTurbulence type="fractalNoise" baseFrequency="0.018 0.018" numOctaves={5} result="noise" seed="42" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale={14} xChannelSelector="R" yChannelSelector="G" result="displaced" />
          <feGaussianBlur in="displaced" stdDeviation={1.2} result="blurred" />
          <feColorMatrix in="blurred" type="saturate" values="1.2" result="saturated" />
          <feComponentTransfer in="saturated" result="brightened">
            <feFuncR type="linear" slope="1.05" intercept="0.02" />
            <feFuncG type="linear" slope="1.05" intercept="0.02" />
            <feFuncB type="linear" slope="1.05" intercept="0.02" />
          </feComponentTransfer>
          <feBlend in="SourceGraphic" in2="brightened" mode="normal" />
        </filter>

        <filter id="liquid-highlight-subtle" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceAlpha" stdDeviation={1.5} result="blur" />
          <feOffset dx={0} dy={-1} result="offsetBlur" />
          <feFlood flood-color="white" flood-opacity={0.08} result="highlightColor" />
          <feComposite in="highlightColor" in2="offsetBlur" operator="in" result="highlight" />
          <feMerge>
            <feMergeNode in="highlight" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        
        <filter id="liquid-highlight-medium" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceAlpha" stdDeviation={2} result="blur" />
          <feOffset dx={0} dy={-1} result="offsetBlur" />
          <feFlood flood-color="white" flood-opacity={0.12} result="highlightColor" />
          <feComposite in="highlightColor" in2="offsetBlur" operator="in" result="highlight" />
          <feMerge>
            <feMergeNode in="highlight" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        
        <filter id="liquid-highlight-strong" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceAlpha" stdDeviation={3} result="blur" />
          <feOffset dx={0} dy={-1} result="offsetBlur" />
          <feFlood flood-color="white" flood-opacity={0.18} result="highlightColor" />
          <feComposite in="highlightColor" in2="offsetBlur" operator="in" result="highlight" />
          <feMerge>
            <feMergeNode in="highlight" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
    </svg>
  );
}