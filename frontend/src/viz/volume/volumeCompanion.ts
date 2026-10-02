/* Phase 4G — volume companion model (pure: no React, no Bklit, no I/O).
   Owns the subordinate volume-strip math for Price History:
   - Genuine-volume predicate (finite numbers only; 0 is a legitimate
     source value, null/undefined/NaN/Infinity are "unavailable" — NEVER
     coerced to 0 and NEVER fabricated).
   - Per-bar direction derived from the existing price relationship
     (close >= open → up) only when BOTH are finite; otherwise neutral.
   - Compact volume formatting for axis/tooltip labels.
   - Bar layout math that mirrors Bklit's own candlestick x-derivation
     (slotWidth = innerWidth / count, half-slot edge padding, linear time
     mapping) so volume bars center exactly under price candles when both
     are fed the SAME row window. The caller owns the window — this module
     never slices, never reorders, never invents rows. */

export interface VolumeBarInput {
  readonly date: Date;
  readonly open?: number;
  readonly close: number;
  readonly volume?: number;
}

export type VolumeDirection = 'up' | 'down' | 'neutral';

export const VOLUME_COLORS = {
  up: 'rgba(52,211,153,0.55)',
  negative: 'rgba(248,113,96,0.55)',
  neutral: 'rgba(148,163,184,0.45)',
  axis: '#94A3B8',
  baseline: 'rgba(167,139,250,0.16)',
} as const;

/** Fraction of a time slot occupied by a volume bar (subordinate look). */
export const VOLUME_BAR_WIDTH_FRACTION = 0.65;

/** Y-headroom above the largest visible bar (volume is zero-anchored). */
export const VOLUME_Y_HEADROOM = 1.1;

/** A volume value is usable only when it is a genuine finite number.
   0 is valid (the backend allows ge=0); missing/invalid stays unusable. */
export function isFiniteVolume(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/* Direction follows the existing candle convention, but ONLY when both
   legs are finite. Anything else is neutral — direction is never guessed. */
export function volumeDirection(open: unknown, close: unknown): VolumeDirection {
  if (typeof open !== 'number' || !Number.isFinite(open)) return 'neutral';
  if (typeof close !== 'number' || !Number.isFinite(close)) return 'neutral';
  return close >= open ? 'up' : 'down';
}

export function volumeColorFor(direction: VolumeDirection): string {
  if (direction === 'up') return VOLUME_COLORS.up;
  if (direction === 'down') return VOLUME_COLORS.negative;
  return VOLUME_COLORS.neutral;
}

const compactVolumeFmt = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function formatVolumeCompact(value: number): string {
  if (!isFiniteVolume(value)) return '—';
  return compactVolumeFmt.format(value);
}

/** Rows in the window carrying genuine volume (order preserved). */
export function finiteVolumeRows(
  rows: readonly VolumeBarInput[]
): VolumeBarInput[] {
  return rows.filter((r) => isFiniteVolume(r.volume));
}

export function countFiniteVolume(rows: readonly VolumeBarInput[]): number {
  let count = 0;
  for (const r of rows) {
    if (isFiniteVolume(r.volume)) count += 1;
  }
  return count;
}

export interface VolumeBarGeometry {
  /** Bar left edge in strip-inner coordinates. */
  readonly x: number;
  /** Bar top in strip-inner coordinates. */
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Horizontal center — equals the price candle center for the same row. */
  readonly centerX: number;
  readonly direction: VolumeDirection;
  readonly volume: number;
  readonly time: number;
}

/* Bar geometries for the given window. Mirrors
   candlestick-chart.tsx: slotWidth = innerWidth / max(count,1),
   x(t) linear in ms over [minT, maxT] → [pad, innerWidth-pad] with
   pad = slotWidth/2. Rows without finite volume produce NO geometry
   (honest gap, same slot still reserved by index). Never throws;
   degenerate input yields an empty array (caller hides the strip). */
export function computeVolumeLayout(
  rows: readonly VolumeBarInput[],
  innerWidth: number,
  innerHeight: number
): VolumeBarGeometry[] {
  const count = rows.length;
  if (count === 0) return [];
  if (!Number.isFinite(innerWidth) || innerWidth <= 0) return [];
  if (!Number.isFinite(innerHeight) || innerHeight <= 0) return [];

  let maxVolume = 0;
  let minTime = Number.POSITIVE_INFINITY;
  let maxTime = Number.NEGATIVE_INFINITY;
  for (const r of rows) {
    const t = r.date instanceof Date ? r.date.getTime() : NaN;
    if (Number.isFinite(t)) {
      if (t < minTime) minTime = t;
      if (t > maxTime) maxTime = t;
    }
    if (isFiniteVolume(r.volume) && (r.volume as number) > maxVolume) {
      maxVolume = r.volume as number;
    }
  }
  if (!Number.isFinite(minTime) || !Number.isFinite(maxTime)) return [];
  if (maxVolume <= 0) return [];

  const slotWidth = innerWidth / Math.max(count, 1);
  const pad = slotWidth / 2;
  const span = innerWidth - pad * 2;
  const timeRange = maxTime - minTime;
  const barWidth = Math.max(1, slotWidth * VOLUME_BAR_WIDTH_FRACTION);
  const domainMax = maxVolume * VOLUME_Y_HEADROOM;

  const xOf = (t: number): number => {
    if (timeRange <= 0) return innerWidth / 2;
    return pad + ((t - minTime) / timeRange) * span;
  };

  const geometries: VolumeBarGeometry[] = [];
  for (const r of rows) {
    if (!isFiniteVolume(r.volume)) continue;
    const volume = r.volume as number;
    const t = (r.date as Date).getTime();
    if (!Number.isFinite(t)) continue;
    const centerX = xOf(t);
    const height = Math.max(0, (volume / domainMax) * innerHeight);
    const direction = volumeDirection(r.open, r.close);
    geometries.push({
      x: centerX - barWidth / 2,
      y: innerHeight - height,
      width: barWidth,
      height,
      centerX,
      direction,
      volume,
      time: t,
    });
  }
  return geometries;
}
