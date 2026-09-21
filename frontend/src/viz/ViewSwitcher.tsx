'use client';

import { cn } from '@/lib/utils';

/* Phase 3C — reusable visualization ViewSwitcher.
   Presentational control only: options come from the registry (single
   source of truth), validity/defaults stay with the centralized
   resolver, and switching only changes which renderer mounts — the same
   memoized display-data object feeds every view, so no refetch,
   recalculation, or API call can result from a view change.

   Deliberately generic over the view-id type so future datasets reuse
   it without chart-type conditionals living here. */

export interface ViewSwitcherOption<TViewId extends string> {
  readonly id: TViewId;
  readonly label: string;
  readonly a11y?: string;
}

interface ViewSwitcherProps<TViewId extends string> {
  /* Registry dataset key (e.g. "terminal-distribution"); scopes the
     accessible group label. */
  readonly datasetKey: string;
  /* Ordered options derived from the registry entry
     (registry.viewIds.map((id) => registry.views[id])). */
  readonly views: readonly ViewSwitcherOption<TViewId>[];
  readonly value: TViewId;
  readonly onChange: (viewId: TViewId) => void;
  readonly label?: string;
}

export function ViewSwitcher<TViewId extends string>({
  datasetKey,
  views,
  value,
  onChange,
  label = 'View',
}: ViewSwitcherProps<TViewId>) {
  /* A dataset with fewer than two valid views has no choice to offer;
     the resolver still owns its single default rendering. */
  if (views.length < 2) return null;

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`${label}: ${datasetKey}`}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-lg border border-[rgba(167,139,250,0.16)] bg-white/[0.02] p-0.5">
        {views.map((view) => {
          const selected = view.id === value;
          return (
            <button
              key={view.id}
              type="button"
              onClick={() => onChange(view.id)}
              aria-pressed={selected}
              aria-label={view.a11y ?? view.label}
              title={view.a11y ?? view.label}
              className={cn(
                'h-9 rounded-md px-3 text-xs font-medium transition-colors duration-200',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected
                  ? 'border border-[rgba(167,139,250,0.35)] bg-[rgba(124,58,237,0.25)] text-[#EDE9FE]'
                  : 'border border-transparent text-muted-foreground hover:bg-white/[0.04] hover:text-foreground'
              )}
            >
              {view.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
