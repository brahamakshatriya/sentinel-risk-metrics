/* Phase 3A — smallest registry slice: `terminal-distribution` only.
   Closed allowlist + centralized resolution so invalid views are
   unrepresentable at the call site (no scattered validity checks).
   Future datasets get their own entries here; nothing else changes. */

export const TERMINAL_DISTRIBUTION_DATASET_KEY = 'terminal-distribution' as const;

export type TerminalDistributionDatasetKey = typeof TERMINAL_DISTRIBUTION_DATASET_KEY;

export type TerminalDistributionViewId = 'histogram';

export interface TerminalDistributionViewDefinition {
  readonly id: TerminalDistributionViewId;
  readonly label: string;
  readonly category: 'distribution';
  readonly rendererId: 'histogram';
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

const TERMINAL_DISTRIBUTION_VIEWS: Record<TerminalDistributionViewId, TerminalDistributionViewDefinition> = {
  histogram: HISTOGRAM_VIEW,
};

export const TERMINAL_DISTRIBUTION_REGISTRY = {
  datasetKey: TERMINAL_DISTRIBUTION_DATASET_KEY,
  defaultViewId: 'histogram' as TerminalDistributionViewId,
  viewIds: ['histogram' as TerminalDistributionViewId],
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
