'use client';

import { useMemo, useState } from 'react';
import { usePriceHistory } from '@/hooks/useApi';
import { Button } from '@/components/ui/Button';
import { adaptPriceHistory } from '@/viz/adapters/priceHistory';
import {
  PRICE_HISTORY_REGISTRY,
  getAvailablePriceHistoryViews,
  resolvePriceHistoryView,
  type PriceHistoryViewId,
} from '@/viz/registry';
import { ViewSwitcher } from '@/viz/ViewSwitcher';
import { PriceLine } from '@/viz/renderers/PriceLine';
import { PriceArea } from '@/viz/renderers/PriceArea';
import { PriceCandlestick } from '@/viz/renderers/PriceCandlestick';

/* Phase 4 — price-history proof surface.
   One real wiring of the full pipeline for a single symbol:
   usePriceHistory → adaptPriceHistory (memoized on the query payload)
   → registry + ViewSwitcher → Bklit renderer. Switching views only
   remounts the renderer; the memoized canonical object is shared, so no
   refetch or recalculation can result from a view change. */

interface PriceHistoryCardProps {
  symbol: string;
}

export function PriceHistoryCard({ symbol }: PriceHistoryCardProps) {
  const query = usePriceHistory(symbol);

  /* Canonical dataset, derived once per query payload. Hooks stay above
     the state guards so hook order is stable across transitions. */
  const canonical = useMemo(
    () => (query.data ? adaptPriceHistory(symbol, query.data) : null),
    [symbol, query.data]
  );

  const [selectedView, setSelectedView] = useState<PriceHistoryViewId>(
    PRICE_HISTORY_REGISTRY.defaultViewId
  );

  const flags = canonical?.flags ?? { hasOHLC: false, hasVolume: false };
  const availableViews = getAvailablePriceHistoryViews(flags);
  const resolvedView = resolvePriceHistoryView(flags, selectedView);

  if (query.isLoading) {
    return (
      <div className="sentinel-card p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-muted rounded-lg w-1/4" />
          <div className="h-64 bg-muted rounded-lg" />
        </div>
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="sentinel-card p-6 text-center" role="alert">
        <p className="text-red-300 font-medium mb-2">Failed to load price history for {symbol}</p>
        <p className="text-sm text-muted-foreground mb-4">
          {query.error instanceof Error ? query.error.message : 'Unknown error'}
        </p>
        <Button variant="outline" size="sm" onClick={() => query.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  if (!canonical || canonical.points.length === 0) {
    return (
      <div className="sentinel-card p-6 text-center">
        <p className="text-muted-foreground">No price history for {symbol} yet</p>
        <p className="text-sm text-muted-foreground mt-2">Fetch price data to enable market charts</p>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <div className="mb-3">
        <ViewSwitcher
          datasetKey={PRICE_HISTORY_REGISTRY.datasetKey}
          views={availableViews}
          value={selectedView}
          onChange={setSelectedView}
        />
      </div>
      {resolvedView.rendererId === 'line' && <PriceLine data={canonical} />}
      {resolvedView.rendererId === 'area' && <PriceArea data={canonical} />}
      {resolvedView.rendererId === 'candlestick' && <PriceCandlestick data={canonical} />}
    </div>
  );
}
