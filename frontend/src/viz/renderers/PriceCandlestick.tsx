'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CandlestickChart } from '@/components/charts/candlestick-chart';
import { Candlestick } from '@/components/charts/candlestick';
import { Grid } from '@/components/charts/grid';
import { XAxis } from '@/components/charts/x-axis';
import { YAxis } from '@/components/charts/y-axis';
import { ChartTooltip } from '@/components/charts/tooltip/chart-tooltip';
import { formatCurrency, formatDate } from '@/lib/utils';
import type { CanonicalPriceHistory } from '@/viz/adapters/priceHistory';
import {
  ZOOM_IN_FACTOR,
  ZOOM_OUT_FACTOR,
  clampViewport,
  effectiveMinVisible,
  fullViewport,
  wheelDeltaToFactor,
  zoomViewport,
  type CandleViewport,
} from '@/viz/viewport/candleViewport';

/* Phase 4 — price-history candlestick renderer (Bklit).
   Genuine OHLC only: rows are built exclusively from points carrying
   all four finite values. NOTHING is synthesized — no open = close,
   no high/low = close, no previous-close carry. The registry gate
   (flags.hasOHLC) keeps this view unreachable otherwise; the filter
   below is defense-in-depth, not a fallback data source.
   Up/down fills follow Sentinel's existing semantic tokens
   (emerald-400 / red-400, as in getRiskColor).

   Interactive viewport (no backend/risk changes): wheel zoom + −/+/Reset
   operate on a bounded `[start, end)` index window over the render-ready
   rows. The canonical dataset is never mutated — the visible slice is
   passed to `CandlestickChart` as `data`, so candle width (slotWidth =
   innerWidth / visibleCount) and the padded Y-domain both follow the
   visible window via existing Bklit behaviour. No custom price math. */

const PRICE_CANDLE = {
  positiveFill: '#34D399',
  negativeFill: '#F87160',
  grid: 'rgba(167,139,250,0.14)',
  crosshair: 'rgba(167,139,250,0.6)',
} as const;

const ZOOM_BUTTON_CLASS =
  'inline-flex h-7 w-7 items-center justify-center rounded-md border border-[rgba(167,139,250,0.16)] bg-white/[0.02] text-sm leading-none text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(167,139,250,0.6)] disabled:pointer-events-none disabled:opacity-40';

const RESET_BUTTON_CLASS =
  'inline-flex h-7 items-center justify-center rounded-md border border-[rgba(167,139,250,0.16)] bg-white/[0.02] px-2 text-xs text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(167,139,250,0.6)] disabled:pointer-events-none disabled:opacity-40';

interface PriceCandlestickProps {
  data: CanonicalPriceHistory;
}

export function PriceCandlestick({ data }: PriceCandlestickProps) {
  const { rows, maxHigh } = useMemo(() => {
    let max = 0;
    const mapped = data.points
      .filter(
        (p) =>
          p.open !== undefined &&
          p.high !== undefined &&
          p.low !== undefined &&
          Number.isFinite(p.open) &&
          Number.isFinite(p.high) &&
          Number.isFinite(p.low)
      )
      .map((p) => {
        if ((p.high as number) > max) max = p.high as number;
        return {
          date: new Date(p.timestamp),
          open: p.open as number,
          high: p.high as number,
          low: p.low as number,
          close: p.close,
        };
      });
    return { rows: mapped, maxHigh: max };
  }, [data]);

  const total = rows.length;

  /* Viewport state — local to this visualization. Null-safe init; the
     effect below keeps it clamped when the dataset changes. */
  const [viewport, setViewport] = useState<CandleViewport>(() => fullViewport(total));
  const symbolRef = useRef(data.symbol);
  useEffect(() => {
    if (symbolRef.current !== data.symbol) {
      symbolRef.current = data.symbol;
      setViewport(fullViewport(total));
      return;
    }
    setViewport((prev) => {
      const next = clampViewport(prev, total);
      return next.start === prev.start && next.end === prev.end ? prev : next;
    });
  }, [data.symbol, total]);

  const visibleRows = useMemo(
    () => rows.slice(viewport.start, viewport.end),
    [rows, viewport]
  );
  const visibleCount = viewport.end - viewport.start;
  const minVisible = effectiveMinVisible(total);
  const interactable = total > minVisible && minVisible > 0;
  const isFull = visibleCount >= total;
  const canZoomIn = interactable && visibleCount > minVisible;
  const canZoomOut = interactable && visibleCount < total;

  const zoomIn = useCallback(() => {
    setViewport((prev) => zoomViewport(prev, total, ZOOM_IN_FACTOR, 0.5));
  }, [total]);
  const zoomOut = useCallback(() => {
    setViewport((prev) => zoomViewport(prev, total, ZOOM_OUT_FACTOR, 0.5));
  }, [total]);
  const resetZoom = useCallback(() => {
    setViewport(fullViewport(total));
  }, [total]);

  /* Pointer-anchored wheel zoom, scoped to the chart area. Native
     non-passive listener so preventDefault works without hijacking
     page scroll outside this element. Wheel bursts are coalesced via
     rAF into one state update per frame; the adapter is NOT recomputed
     (rows memo only depends on canonical data). At the min/max bounds
     the event is left unprevented so the page can keep scrolling. */
  const zoomAreaRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const totalRef = useRef(total);
  totalRef.current = total;
  useEffect(() => {
    const el = zoomAreaRef.current;
    if (!el || totalRef.current <= 1) return;
    let rafId = 0;
    let pendingFactor = 1;
    let pendingAnchor = 0.5;

    const applyPending = () => {
      rafId = 0;
      const factor = pendingFactor;
      const anchor = pendingAnchor;
      pendingFactor = 1;
      if (factor === 1) return;
      setViewport((prev) =>
        zoomViewport(prev, totalRef.current, factor, anchor)
      );
    };

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey && !Number.isFinite(event.deltaY)) return;
      const factor = wheelDeltaToFactor(event.deltaY);
      if (factor === 1) return;
      const rect = el.getBoundingClientRect();
      const anchor =
        rect.width > 0
          ? (event.clientX - rect.left) / rect.width
          : 0.5;
      // Probe bounds first: at min/max there is nothing to zoom, so let
      // the page scroll instead of trapping the wheel.
      const probe = zoomViewport(
        viewportRef.current,
        totalRef.current,
        factor,
        anchor
      );
      if (
        probe.start === viewportRef.current.start &&
        probe.end === viewportRef.current.end
      ) {
        return;
      }
      event.preventDefault();
      pendingFactor *= factor;
      pendingAnchor = anchor;
      if (rafId === 0) {
        rafId = requestAnimationFrame(applyPending);
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (rafId !== 0) cancelAnimationFrame(rafId);
      rafId = 0;
      pendingFactor = 1;
    };
  }, [total > 1]);

  const first = data.points[0];
  const last = data.points[data.points.length - 1];
  const visibleFirst = visibleRows[0];
  const visibleLast = visibleRows[visibleRows.length - 1];

  return (
    <div className="sentinel-card min-w-0 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[rgba(167,139,250,0.16)] p-4">
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Market data</p>
          <h4 className="mt-1 font-semibold text-foreground">{data.symbol} Price History</h4>
          <p className="text-sm text-muted-foreground">
            {rows.length} daily candles · {first ? formatDate(first.date) : '—'} →{' '}
            {last ? formatDate(last.date) : '—'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground" aria-live="polite">
            Showing {visibleCount} / {total} candles
            {!isFull && visibleFirst && visibleLast
              ? ` · ${formatDate(visibleFirst.date.toISOString().slice(0, 10))} → ${formatDate(visibleLast.date.toISOString().slice(0, 10))}`
              : ''}
          </p>
        </div>
        <div className="flex items-center gap-1.5" role="group" aria-label="Chart zoom controls">
          <button
            type="button"
            className={ZOOM_BUTTON_CLASS}
            onClick={zoomOut}
            disabled={!canZoomOut}
            aria-label="Zoom out (show more candles)"
            title="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            className={ZOOM_BUTTON_CLASS}
            onClick={zoomIn}
            disabled={!canZoomIn}
            aria-label="Zoom in (show fewer candles)"
            title="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            className={RESET_BUTTON_CLASS}
            onClick={resetZoom}
            disabled={isFull}
            aria-label="Reset zoom to full price history"
            title="Reset zoom"
          >
            Reset
          </button>
        </div>
      </div>
      <div
        ref={zoomAreaRef}
        className="h-[300px] p-4 sm:h-[350px]"
        title="Scroll to zoom · double-click to reset"
        onDoubleClick={resetZoom}
      >
        <CandlestickChart data={visibleRows} style={{ height: '100%' }}>
          <Grid horizontal stroke={PRICE_CANDLE.grid} strokeDasharray="4,4" />
          <Candlestick
            positiveFill={PRICE_CANDLE.positiveFill}
            negativeFill={PRICE_CANDLE.negativeFill}
          />
          <XAxis />
          <YAxis
            formatValue={(v: number) =>
              Math.abs(maxHigh) >= 10000
                ? `$${(v / 1000).toFixed(0)}k`
                : `$${Math.round(v).toLocaleString()}`
            }
          />
          <ChartTooltip
            indicatorColor={PRICE_CANDLE.crosshair}
            rows={(point) => [
              { color: PRICE_CANDLE.positiveFill, label: 'Open', value: formatCurrency((point.open as number) ?? 0) },
              { color: PRICE_CANDLE.positiveFill, label: 'High', value: formatCurrency((point.high as number) ?? 0) },
              { color: PRICE_CANDLE.negativeFill, label: 'Low', value: formatCurrency((point.low as number) ?? 0) },
              { color: PRICE_CANDLE.negativeFill, label: 'Close', value: formatCurrency((point.close as number) ?? 0) },
            ]}
          />
        </CandlestickChart>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-[rgba(167,139,250,0.16)] bg-white/[0.015] p-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded" style={{ backgroundColor: PRICE_CANDLE.positiveFill }}></span>
          <span>Up (close ≥ open)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded" style={{ backgroundColor: PRICE_CANDLE.negativeFill }}></span>
          <span>Down (close &lt; open)</span>
        </div>
      </div>
    </div>
  );
}
