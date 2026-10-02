'use client';

import { useMemo } from 'react';
import { ParentSize } from '@visx/responsive';
import { formatDate } from '@/lib/utils';
import {
  VOLUME_COLORS,
  computeVolumeLayout,
  countFiniteVolume,
  formatVolumeCompact,
  volumeColorFor,
  type VolumeBarInput,
} from '@/viz/volume/volumeCompanion';

/* Phase 4G — price volume companion (subordinate SVG strip, no Bklit
   shell, no new chart library).
   Receives the SAME render-ready row window the price chart renders
   (the candlestick viewport slice, or the full rows for Line/Area), so
   price/volume time alignment and zoom sync hold by construction — this
   component owns no viewport state and performs no slicing. Bars use the
   shared visx scale primitives already in the dependency tree; Bklit
   itself is untouched. Rows without genuine volume render as gaps
   (never 0-filled); the whole strip hides when the window carries no
   finite volume. No animation, no gradients, no glass. */

const STRIP_MARGIN = { top: 8, right: 40, bottom: 12, left: 40 } as const;

interface PriceVolumeCompanionProps {
  /** Already-windowed render-ready rows (same array the price shows). */
  readonly rows: readonly VolumeBarInput[];
  readonly symbol: string;
}

export function PriceVolumeCompanion({ rows, symbol }: PriceVolumeCompanionProps) {
  const finiteCount = useMemo(() => countFiniteVolume(rows), [rows]);
  if (finiteCount === 0 || rows.length === 0) return null;

  const first = rows[0];
  const last = rows[rows.length - 1];
  const rangeLabel =
    first && last
      ? `${formatDate(first.date)} → ${formatDate(last.date)}`
      : '';

  return (
    <div
      role="img"
      aria-label={`Trading volume for ${symbol}: ${finiteCount} bars with reported volume out of ${rows.length} sessions${rangeLabel ? `, ${rangeLabel}` : ''}`}
    >
      <ParentSize debounceTime={10}>
        {({ width, height }) => {
          if (width < 10 || height < 10) return null;
          return (
            <VolumeStrip
              rows={rows}
              symbol={symbol}
              width={width}
              height={height}
            />
          );
        }}
      </ParentSize>
    </div>
  );
}

function VolumeStrip({
  rows,
  symbol,
  width,
  height,
}: {
  rows: readonly VolumeBarInput[];
  symbol: string;
  width: number;
  height: number;
}) {
  const innerWidth = width - STRIP_MARGIN.left - STRIP_MARGIN.right;
  const innerHeight = height - STRIP_MARGIN.top - STRIP_MARGIN.bottom;

  const geometries = useMemo(
    () => computeVolumeLayout(rows, innerWidth, innerHeight),
    [rows, innerWidth, innerHeight]
  );

  const ticks = useMemo(() => {
    let maxVolume = 0;
    for (const g of geometries) {
      if (g.volume > maxVolume) maxVolume = g.volume;
    }
    if (maxVolume <= 0 || innerHeight <= 0) return [];
    const domainMax = maxVolume * 1.1;
    const yOf = (v: number) => innerHeight - (v / domainMax) * innerHeight;
    return [0, maxVolume / 2, maxVolume].map((v) => ({
      value: v,
      y: yOf(v),
      label: v === 0 ? '0' : formatVolumeCompact(v),
    }));
  }, [geometries, innerHeight]);

  if (geometries.length === 0) return null;

  return (
    <svg
      aria-hidden="true"
      height={height}
      width={width}
      focusable="false"
    >
      <g transform={`translate(${STRIP_MARGIN.left},${STRIP_MARGIN.top})`}>
        {/* Baseline (zero-anchored volume domain). */}
        <line
          x1={0}
          x2={innerWidth}
          y1={innerHeight}
          y2={innerHeight}
          stroke={VOLUME_COLORS.baseline}
          strokeWidth={1}
        />
        {ticks.map((tick) => (
          <text
            key={tick.label}
            x={-6}
            y={tick.y}
            textAnchor="end"
            dominantBaseline="middle"
            fontSize={10}
            fill={VOLUME_COLORS.axis}
          >
            {tick.label}
          </text>
        ))}
        {geometries.map((g) => (
          <rect
            key={`${symbol}-${g.time}`}
            x={g.x}
            y={g.y}
            width={g.width}
            height={Math.max(g.height, g.volume > 0 ? 1 : 0)}
            rx={1}
            fill={volumeColorFor(g.direction)}
          >
            <title>{`${formatDate(new Date(g.time))} — Volume ${g.volume.toLocaleString('en-US')}`}</title>
          </rect>
        ))}
      </g>
    </svg>
  );
}
