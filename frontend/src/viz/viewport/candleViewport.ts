/* Candle viewport — pure bounded index-window model for the Bklit candlestick.
   Viewport-only interaction: selects which slice of the already-valid
   render-ready OHLC rows is passed to `CandlestickChart` as `data`.
   NEVER touches canonical data, the adapter, the registry, or the API.
   Window is `[start, end)` over row indices; chronological order is
   preserved because slicing never reorders. */

export interface CandleViewport {
  readonly start: number;
  readonly end: number;
}

/** Minimum visible candles so zoom-in cannot collapse to a single bar. */
export const MIN_VISIBLE_CANDLES = 10;

/** Button-step factors: zoom-in shrinks ~25%, zoom-out grows ~33%. */
export const ZOOM_IN_FACTOR = 0.75;
export const ZOOM_OUT_FACTOR = 1.35;

/** Wheel sensitivity for exp-based zoom (per deltaY unit). */
export const WHEEL_ZOOM_SENSITIVITY = 0.0016;

/** Clamp per wheel event so trackpad bursts cannot jump the full range. */
export const WHEEL_FACTOR_MIN = 0.6;
export const WHEEL_FACTOR_MAX = 1.5;

export function viewportLength(viewport: CandleViewport): number {
  return viewport.end - viewport.start;
}

export function effectiveMinVisible(total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.min(MIN_VISIBLE_CANDLES, Math.floor(total));
}

/** Full-dataset window. Safe for total <= 0 (returns an empty window). */
export function fullViewport(total: number): CandleViewport {
  if (!Number.isFinite(total) || total <= 0) return { start: 0, end: 0 };
  return { start: 0, end: Math.floor(total) };
}

function clampAnchor(anchor: number): number {
  if (!Number.isFinite(anchor)) return 0.5;
  if (anchor < 0) return 0;
  if (anchor > 1) return 1;
  return anchor;
}

/* Normalize any candidate window into a valid bounded viewport:
   integers, start <= end, inside [0, total], length in [minLen, total].
   Never throws; invalid input falls back to the full window. */
export function clampViewport(
  candidate: CandleViewport,
  total: number,
  minVisible: number = MIN_VISIBLE_CANDLES
): CandleViewport {
  if (!Number.isFinite(total) || total <= 0) return { start: 0, end: 0 };
  const count = Math.floor(total);
  const minLen = Math.max(
    0,
    Math.min(
      Math.floor(Number.isFinite(minVisible) ? minVisible : MIN_VISIBLE_CANDLES),
      count
    )
  );

  let start = Number.isFinite(candidate.start) ? Math.floor(candidate.start) : 0;
  let end = Number.isFinite(candidate.end) ? Math.floor(candidate.end) : count;
  if (start > end) {
    const tmp = start;
    start = end;
    end = tmp;
  }

  let length = end - start;
  if (length < minLen) {
    // Grow around the anchor-free center of the candidate window.
    const center = start + length / 2;
    length = minLen;
    start = Math.round(center - length / 2);
  } else if (length > count) {
    length = count;
    start = 0;
  }

  const maxStart = Math.max(0, count - length);
  if (!Number.isFinite(start)) start = 0;
  start = Math.min(Math.max(start, 0), maxStart);
  return { start, end: start + length };
}

export function isFullViewport(viewport: CandleViewport, total: number): boolean {
  if (!Number.isFinite(total) || total <= 0) return true;
  return viewport.start <= 0 && viewport.end >= Math.floor(total);
}

/* Core zoom step. `factor < 1` zooms in (fewer candles), `factor > 1`
   zooms out. `anchor` (0..1) is the pointer fraction inside the current
   window that stays approximately fixed. Returns the current window
   unchanged when no movement is possible (bounds/min/max reached). */
export function zoomViewport(
  current: CandleViewport,
  total: number,
  factor: number,
  anchor: number = 0.5,
  minVisible: number = MIN_VISIBLE_CANDLES
): CandleViewport {
  const base = clampViewport(current, total, minVisible);
  const count = Math.floor(total);
  if (count <= 0 || !Number.isFinite(factor) || factor <= 0) return base;

  const length = base.end - base.start;
  const minLen = Math.max(0, Math.min(Math.floor(minVisible), count));
  const safeMin = Math.max(minLen, 1);
  if (count <= safeMin) return fullViewport(count);

  let nextLength = Math.round(length * factor);
  if (nextLength < safeMin) nextLength = safeMin;
  if (nextLength > count) nextLength = count;
  if (nextLength === length) return base;

  const a = clampAnchor(anchor);
  const maxStart = count - nextLength;
  let nextStart = Math.round(base.start + (length - nextLength) * a);
  if (!Number.isFinite(nextStart)) nextStart = base.start;
  nextStart = Math.min(Math.max(nextStart, 0), maxStart);
  return { start: nextStart, end: nextStart + nextLength };
}

/** Wheel delta → bounded zoom factor (deltaY > 0 zooms out). */
export function wheelDeltaToFactor(deltaY: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 1;
  const raw = Math.exp(deltaY * WHEEL_ZOOM_SENSITIVITY);
  if (!Number.isFinite(raw)) return 1;
  return Math.min(WHEEL_FACTOR_MAX, Math.max(WHEEL_FACTOR_MIN, raw));
}
