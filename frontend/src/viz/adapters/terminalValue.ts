/* Phase 3A — TerminalValueAdapter.
   Pure, synchronous, frontend-only derivation for the
   `terminal-distribution` dataset (Monte Carlo final values).

   Owns the binning + tail-annotation logic previously inline in
   MonteCarloChart. Behavior is verbatim preservation, including:
   - default bin count 30
   - equal-width bins over [min, max]
   - count = values with binStart <= v < binEnd
   - tail = binEnd <= currentValue - var
   - range label `${start.toFixed(0)}-${end.toFixed(0)}`

   The adapter MUST NOT calculate VaR/CVaR, alter units, fabricate
   values, mutate input, or fetch data. It receives already-coerced
   numeric canonical data (string parsing lives at the existing
   coercion boundary in portfolios/[id]/page.tsx, never here). */

export interface TerminalDistributionInput {
  readonly finalValues: readonly number[];
  readonly currentValue: number;
  readonly var: number;
}

export interface TerminalValueAdapterOptions {
  readonly binCount?: number;
}

export interface TerminalHistogramBin {
  readonly rangeStart: number;
  readonly rangeEnd: number;
  readonly range: string;
  readonly count: number;
  readonly isTail: boolean;
}

export interface TerminalDistributionDisplayData {
  readonly bins: readonly TerminalHistogramBin[];
  readonly varThreshold: number;
  readonly currentValue: number;
  readonly simulationCount: number;
  readonly binCount: number;
  readonly minValue: number;
  readonly maxValue: number;
}

/* Preserved histogram resolution. Passed explicitly by callers so the
   choice stays visible at the call site rather than buried here. */
export const DEFAULT_TERMINAL_BIN_COUNT = 30;

export function adaptTerminalDistribution(
  input: TerminalDistributionInput,
  options: TerminalValueAdapterOptions = {}
): TerminalDistributionDisplayData {
  const binCount = options.binCount ?? DEFAULT_TERMINAL_BIN_COUNT;
  const varThreshold = input.currentValue - input.var;

  if (input.finalValues.length === 0) {
    return {
      bins: [],
      varThreshold,
      currentValue: input.currentValue,
      simulationCount: 0,
      binCount,
      minValue: Number.POSITIVE_INFINITY,
      maxValue: Number.NEGATIVE_INFINITY,
    };
  }

  const minVal = Math.min(...input.finalValues);
  const maxVal = Math.max(...input.finalValues);
  const binWidth = (maxVal - minVal) / binCount;

  const bins: TerminalHistogramBin[] = [];
  for (let i = 0; i < binCount; i++) {
    const binStart = minVal + i * binWidth;
    const binEnd = binStart + binWidth;
    const count = input.finalValues.filter((v) => v >= binStart && v < binEnd).length;
    const isTail = binEnd <= input.currentValue - input.var;
    bins.push({
      rangeStart: binStart,
      rangeEnd: binEnd,
      range: `${binStart.toFixed(0)}-${binEnd.toFixed(0)}`,
      count,
      isTail,
    });
  }

  return {
    bins,
    varThreshold,
    currentValue: input.currentValue,
    simulationCount: input.finalValues.length,
    binCount,
    minValue: minVal,
    maxValue: maxVal,
  };
}
