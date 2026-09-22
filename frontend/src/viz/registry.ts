/* Phase 3A/3B — registry slice: `terminal-distribution` only.
   Closed allowlist + centralized resolution so invalid views are
   unrepresentable at the call site (no scattered validity checks).
   Histogram is the default; density is the second proven view.
   Future datasets/views get their own entries here; nothing else changes. */

export const TERMINAL_DISTRIBUTION_DATASET_KEY = 'terminal-distribution' as const;

export type TerminalDistributionDatasetKey = typeof TERMINAL_DISTRIBUTION_DATASET_KEY;

export type TerminalDistributionViewId = 'histogram' | 'density';

export type TerminalDistributionRendererId = 'histogram' | 'density';

export interface TerminalDistributionViewDefinition {
  readonly id: TerminalDistributionViewId;
  readonly label: string;
  readonly category: 'distribution';
  readonly rendererId: TerminalDistributionRendererId;
  readonly a11y: string;
  readonly supportsMobile: boolean;
}

export const HISTOGRAM_VIEW: TerminalDistributionViewDefinition = {
  id: 'histogram',
  label: 'Histogram',
  category: 'distribution',
  rendererId: 'histogram',
  a11y: 'Final portfolio-value frequency by range. Bins at or below the VaR threshold are marked as the loss tail in the legend and tooltip.',
  supportsMobile: true,
};

export const DENSITY_VIEW: TerminalDistributionViewDefinition = {
  id: 'density',
  label: 'Density',
  category: 'distribution',
  rendererId: 'density',
  a11y: 'Histogram-based probability density of final portfolio values (share of simulations per dollar). The dashed VaR threshold line and legend carry the same loss meaning as the histogram tail.',
  supportsMobile: true,
};

const TERMINAL_DISTRIBUTION_VIEWS: Record<TerminalDistributionViewId, TerminalDistributionViewDefinition> = {
  histogram: HISTOGRAM_VIEW,
  density: DENSITY_VIEW,
};

export const TERMINAL_DISTRIBUTION_REGISTRY = {
  datasetKey: TERMINAL_DISTRIBUTION_DATASET_KEY,
  defaultViewId: 'histogram' as TerminalDistributionViewId,
  viewIds: ['histogram' as TerminalDistributionViewId, 'density' as TerminalDistributionViewId],
  views: TERMINAL_DISTRIBUTION_VIEWS,
} as const;

/* Centralized resolution: unknown, missing, or (once gated views exist)
   gate-failing ids fall back to the registry default. Callers type their
   selection as TerminalDistributionViewId, so invalid ids are a compile
   error before this runtime fallback is even reached. */
export function resolveTerminalDistributionView(
  requested?: string | null
): TerminalDistributionViewDefinition {
  if (requested) {
    const match = (TERMINAL_DISTRIBUTION_VIEWS as Record<string, TerminalDistributionViewDefinition>)[requested];
    if (match) return match;
  }
  return TERMINAL_DISTRIBUTION_REGISTRY.views[TERMINAL_DISTRIBUTION_REGISTRY.defaultViewId];
}

/* ——— Phase 4 — price-history dataset ———
   Line/Area need timestamp + close (always available after coercion).
   Candlestick is gated on genuine per-row OHLC; the gate is evaluated
   against adapter flags, so missing data hides the view instead of
   fabricating candles. Volume stays a future companion, not a view. */

export const PRICE_HISTORY_DATASET_KEY = 'price-history' as const;

export type PriceHistoryDatasetKey = typeof PRICE_HISTORY_DATASET_KEY;

export type PriceHistoryViewId = 'line' | 'area' | 'candlestick';

export type PriceHistoryRendererId = 'line' | 'area' | 'candlestick';

export type PriceHistoryViewGate = 'hasOHLC';

export interface PriceHistoryViewDefinition {
  readonly id: PriceHistoryViewId;
  readonly label: string;
  readonly category: 'trend' | 'financial';
  readonly rendererId: PriceHistoryRendererId;
  readonly gate?: PriceHistoryViewGate;
  readonly a11y: string;
  readonly supportsMobile: boolean;
}

export const PRICE_LINE_VIEW: PriceHistoryViewDefinition = {
  id: 'line',
  label: 'Line',
  category: 'trend',
  rendererId: 'line',
  a11y: 'Daily closing price as a line. Tooltip announces date and closing price.',
  supportsMobile: true,
};

export const PRICE_AREA_VIEW: PriceHistoryViewDefinition = {
  id: 'area',
  label: 'Area',
  category: 'trend',
  rendererId: 'area',
  a11y: 'Daily closing price as a filled area. Same data as the line view.',
  supportsMobile: true,
};

export const PRICE_CANDLESTICK_VIEW: PriceHistoryViewDefinition = {
  id: 'candlestick',
  label: 'Candlestick',
  category: 'financial',
  rendererId: 'candlestick',
  gate: 'hasOHLC',
  a11y: 'Daily open, high, low, and close as candlesticks. Only offered when every bar carries genuine exchange OHLC.',
  supportsMobile: true,
};

const PRICE_HISTORY_VIEWS: Record<PriceHistoryViewId, PriceHistoryViewDefinition> = {
  line: PRICE_LINE_VIEW,
  area: PRICE_AREA_VIEW,
  candlestick: PRICE_CANDLESTICK_VIEW,
};

export const PRICE_HISTORY_REGISTRY = {
  datasetKey: PRICE_HISTORY_DATASET_KEY,
  defaultViewId: 'line' as PriceHistoryViewId,
  viewIds: [
    'line' as PriceHistoryViewId,
    'area' as PriceHistoryViewId,
    'candlestick' as PriceHistoryViewId,
  ],
  views: PRICE_HISTORY_VIEWS,
} as const;

export interface PriceHistoryFlags {
  readonly hasOHLC: boolean;
  readonly hasVolume: boolean;
}

function priceHistoryGatePasses(
  gate: PriceHistoryViewGate | undefined,
  flags: PriceHistoryFlags
): boolean {
  if (!gate) return true;
  if (gate === 'hasOHLC') return flags.hasOHLC;
  return false;
}

/* Valid views for the current dataset, in registry order. Callers feed
   this to ViewSwitcher, so gated views never appear as options. */
export function getAvailablePriceHistoryViews(
  flags: PriceHistoryFlags
): PriceHistoryViewDefinition[] {
  return PRICE_HISTORY_REGISTRY.viewIds
    .map((id) => PRICE_HISTORY_REGISTRY.views[id])
    .filter((view) => priceHistoryGatePasses(view.gate, flags));
}

/* Centralized resolution with gating: unknown ids, missing ids, and
   gate-failing ids (e.g. candlestick without genuine OHLC) all fall
   back to the line default. */
export function resolvePriceHistoryView(
  flags: PriceHistoryFlags,
  requested?: string | null
): PriceHistoryViewDefinition {
  if (requested) {
    const match = (PRICE_HISTORY_VIEWS as Record<string, PriceHistoryViewDefinition>)[requested];
    if (match && priceHistoryGatePasses(match.gate, flags)) return match;
  }
  return PRICE_HISTORY_REGISTRY.views[PRICE_HISTORY_REGISTRY.defaultViewId];
}
