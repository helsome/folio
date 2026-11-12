/** Deterministic, provider-neutral reconciliation of one financial fact. */
export type ReconciliationState =
  | 'agreement'
  | 'within-tolerance'
  | 'material-conflict'
  | 'incomparable'
  | 'insufficient-sources';

export interface FinancialFactCandidate {
  provider: string;
  instrument?: string;
  metric?: string;
  value: number;
  /** Timestamp of the underlying fact, in epoch milliseconds. */
  asOf?: number;
  period?: string;
  currency?: string;
  unit?: string;
  adjustment?: string;
}

/** Caller-supplied conversion with enough provenance to audit the comparison. */
export interface ReconciliationConversion {
  from: string;
  to: string;
  factor: number;
  source: string;
  /** Required for currency rates, in epoch milliseconds. */
  asOf?: number;
}

export interface ReconciliationNormalization {
  provider: string;
  originalValue: number;
  comparableValue: number;
  originalCurrency?: string;
  comparableCurrency?: string;
  originalUnit?: string;
  comparableUnit?: string;
  conversions: ReconciliationConversion[];
}

export interface ReconciliationPolicy {
  version: string;
  absoluteTolerance?: number;
  relativeTolerance?: number;
  providerPriority?: string[];
  /** Refuse monetary comparisons when the currency is not recorded. */
  requireCurrency?: boolean;
  /** Require timestamps to align within this many milliseconds when both exist. */
  maxAsOfSkewMs?: number;
  /** For fiscal dates, match the UTC calendar day even if vendors use different times. */
  requireAsOfCalendarDate?: boolean;
  /** No rate or unit factor is inferred: the caller must supply explicit rules. */
  currencyConversions?: ReconciliationConversion[];
  unitConversions?: ReconciliationConversion[];
  /** Required for currency conversion; measured from each candidate's asOf. */
  maxConversionSkewMs?: number;
}

export interface ReconciliationResult {
  state: ReconciliationState;
  candidates: FinancialFactCandidate[];
  selected?: FinancialFactCandidate;
  discrepancy?: number;
  reason: string;
  policyVersion: string;
  sourceCount?: number;
  selectedReason?: string;
  /** Comparison values and transformations; `candidates` keep the original values. */
  normalizations?: ReconciliationNormalization[];
}

function findConversion(
  conversions: ReconciliationConversion[] | undefined,
  from: string | undefined,
  to: string | undefined
): ReconciliationConversion | undefined {
  if (!from || !to) return undefined;
  return conversions?.find((conversion) => conversion.from === from && conversion.to === to
    && Number.isFinite(conversion.factor) && conversion.factor > 0
    && conversion.source.trim() !== '');
}

function normalizeForComparison(
  candidate: FinancialFactCandidate,
  target: FinancialFactCandidate,
  policy: ReconciliationPolicy
): ReconciliationNormalization | undefined {
  let comparableValue = candidate.value;
  const conversions: ReconciliationConversion[] = [];
  if (candidate.currency !== target.currency) {
    const conversion = findConversion(policy.currencyConversions, candidate.currency, target.currency);
    if (!conversion || conversion.asOf === undefined || !Number.isFinite(conversion.asOf)
      || candidate.asOf === undefined || policy.maxConversionSkewMs === undefined
      || !Number.isFinite(policy.maxConversionSkewMs) || policy.maxConversionSkewMs < 0
      || Math.abs(candidate.asOf - conversion.asOf) > policy.maxConversionSkewMs) return undefined;
    comparableValue *= conversion.factor;
    conversions.push(conversion);
  }
  if (candidate.unit !== target.unit) {
    const conversion = findConversion(policy.unitConversions, candidate.unit, target.unit);
    if (!conversion) return undefined;
    comparableValue *= conversion.factor;
    conversions.push(conversion);
  }
  if (!Number.isFinite(comparableValue)) return undefined;
  return {
    provider: candidate.provider,
    originalValue: candidate.value,
    comparableValue,
    ...(candidate.currency !== undefined ? { originalCurrency: candidate.currency } : {}),
    ...(target.currency !== undefined ? { comparableCurrency: target.currency } : {}),
    ...(candidate.unit !== undefined ? { originalUnit: candidate.unit } : {}),
    ...(target.unit !== undefined ? { comparableUnit: target.unit } : {}),
    conversions: conversions.map((conversion) => ({ ...conversion })),
  };
}

export function reconcileFinancialFacts(
  candidates: FinancialFactCandidate[],
  policy: ReconciliationPolicy
): ReconciliationResult {
  const base = {
    candidates: candidates.map((candidate) => ({ ...candidate })),
    policyVersion: policy.version,
    sourceCount: new Set(candidates.map((candidate) => candidate.provider)).size,
  };
  if (base.sourceCount < 2) {
    return { ...base, state: 'insufficient-sources', reason: 'At least two provider candidates are required.' };
  }

  const first = candidates[0];
  const semanticallyComparable = candidates.every((candidate) =>
    Number.isFinite(candidate.value)
    && candidate.instrument === first.instrument
    && candidate.metric === first.metric
    && candidate.period === first.period
    && (!policy.requireCurrency || Boolean(candidate.currency))
    && candidate.adjustment === first.adjustment
    && (policy.maxAsOfSkewMs === undefined
      || (candidate.asOf !== undefined && first.asOf !== undefined
        && Math.abs(candidate.asOf - first.asOf) <= policy.maxAsOfSkewMs))
    && (!policy.requireAsOfCalendarDate
      || (candidate.asOf !== undefined && first.asOf !== undefined
        && Number.isFinite(candidate.asOf) && Number.isFinite(first.asOf)
        && new Date(candidate.asOf).toISOString().slice(0, 10)
          === new Date(first.asOf).toISOString().slice(0, 10)))
  );
  const normalizations = semanticallyComparable
    ? candidates.map((candidate) => normalizeForComparison(candidate, first, policy))
    : [];
  if (!semanticallyComparable || normalizations.some((normalization) => normalization === undefined)) {
    return {
      ...base,
      state: 'incomparable',
      reason: 'Candidates differ in instrument, metric, period, currency, unit, adjustment, or timestamp semantics; a required conversion may be missing or stale.',
    };
  }

  const normalized = normalizations as ReconciliationNormalization[];
  const values = normalized.map((candidate) => candidate.comparableValue);
  const discrepancy = Math.max(...values) - Math.min(...values);
  const scale = Math.max(...values.map((value) => Math.abs(value)), 1);
  const within = (policy.absoluteTolerance !== undefined && discrepancy <= policy.absoluteTolerance)
    || (policy.relativeTolerance !== undefined && discrepancy / scale <= policy.relativeTolerance);
  const state: ReconciliationState = discrepancy === 0
    ? 'agreement'
    : within ? 'within-tolerance' : 'material-conflict';
  const selected = (policy.providerPriority ?? [])
    .map((provider) => candidates.find((candidate) => candidate.provider === provider))
    .find((candidate) => candidate !== undefined);
  // A material disagreement with no explicit priority must not silently pick
  // whichever provider happened to arrive first.
  const resolved = selected ?? (state === 'material-conflict' ? undefined : first);
  const selectedReason = selected
    ? `Selected provider "${selected.provider}" per policy priority.`
    : resolved ? 'Candidates agree under policy tolerance; first candidate retained.' : undefined;

  return {
    ...base,
    state,
    discrepancy,
    normalizations: normalized,
    ...(resolved ? { selected: { ...resolved }, selectedReason } : {}),
    reason: state === 'agreement'
      ? 'Candidates agree exactly.'
      : state === 'within-tolerance'
        ? 'Difference is within policy tolerance.'
        : 'Material disagreement; candidates are preserved and never averaged.',
  };
}
