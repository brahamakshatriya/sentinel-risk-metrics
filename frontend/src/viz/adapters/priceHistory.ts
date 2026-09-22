import type { PriceHistory } from '@/types/api';

/* Phase 4 — PriceHistoryAdapter.
   Pure, synchronous, frontend-only derivation for the `price-history`
   dataset (per-symbol market prices).

   Owns exactly one job: coercing raw API rows into canonical numeric
   points + presence flags. Behavior contract:
   - Decimal JSON strings are parsed exactly once (existing parseFloat
     convention); null → undefined, never 0.
   - Points without a finite close are dropped (close is the only
     NOT NULL price column; a $0 close would be fabrication).
   - Non-finite open/high/low/volume degrade to undefined on that
     field only — the point survives for Line/Area, and the presence
     flags (hence the candlestick gate) reflect the gap.
   - API ordering is preserved verbatim (route guarantees date-ascending;
     no re-sort that could mask duplicates).
   - Timestamps use the local-noon strategy: Date(y, m-1, d, 12) avoids
     the UTC-midnight off-by-one for YYYY-MM-DD strings in negative-
     offset zones. The original ISO day is preserved for labels.
   - Rows with unparseable dates are dropped (timestamps are never
     invented).

   The adapter MUST NOT fabricate OHLC, calculate risk, fetch data,
   mutate its input, choose a chart, or know anything about Bklit. */

export interface CanonicalPricePoint {
  readonly timestamp: number;
  readonly date: string;
  readonly open?: number;
  readonly high?: number;
  readonly low?: number;
  readonly close: number;
  readonly volume?: number;
}

export interface CanonicalPriceHistory {
  readonly symbol: string;
  readonly points: readonly CanonicalPricePoint[];
  readonly flags: {
    readonly hasOHLC: boolean;
    readonly hasVolume: boolean;
  };
}

function toFiniteNumber(value: string | number | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return typeof num === 'number' && Number.isFinite(num) ? num : undefined;
}

const ISO_DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function toLocalNoonTimestamp(isoDay: string): number | undefined {
  const match = ISO_DAY_RE.exec(isoDay);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const stamp = new Date(year, month - 1, day, 12, 0, 0, 0).getTime();
  return Number.isFinite(stamp) ? stamp : undefined;
}

export function adaptPriceHistory(
  symbol: string,
  raw: readonly PriceHistory[]
): CanonicalPriceHistory {
  const points: CanonicalPricePoint[] = [];

  for (const row of raw) {
    const close = toFiniteNumber(row.close);
    const timestamp = toLocalNoonTimestamp(row.date);
    /* Close and a real timestamp are both required; anything else would
       be an invented observation. */
    if (close === undefined || timestamp === undefined) continue;
    points.push({
      timestamp,
      date: row.date,
      open: toFiniteNumber(row.open),
      high: toFiniteNumber(row.high),
      low: toFiniteNumber(row.low),
      close,
      volume: toFiniteNumber(row.volume),
    });
  }

  const hasOHLC =
    points.length > 0 &&
    points.every(
      (p) =>
        p.open !== undefined &&
        p.high !== undefined &&
        p.low !== undefined
    );
  const hasVolume =
    points.length > 0 && points.every((p) => p.volume !== undefined);

  return {
    symbol,
    points,
    flags: { hasOHLC, hasVolume },
  };
}
