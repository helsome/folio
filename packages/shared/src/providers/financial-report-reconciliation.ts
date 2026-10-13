import type {
  FinancialFactCandidate,
  FinancialReport,
  ProviderResult,
  ReconciliationPolicy,
  ReconciliationConversion,
  ReconciliationResult,
} from '@finagent/core';
import { reconcileFinancialFacts } from '@finagent/core';

export interface FinancialReportComparison {
  metric: string;
  period: string;
  result: ReconciliationResult;
}

export interface FinancialReportReconciliation {
  /** The first successful provider in the gateway's configured routing order. */
  selected?: Extract<ProviderResult<FinancialReport>, { ok: true }>;
  comparisons: FinancialReportComparison[];
}

/** Compare equal statement fields and fiscal periods from every successful provider. */
export function reconcileFinancialReportResults(
  results: ProviderResult<FinancialReport>[],
  policyForMetric: (metric: string) => Partial<ReconciliationPolicy> = () => ({})
): FinancialReportReconciliation {
  const successes = results.filter(
    (result): result is Extract<ProviderResult<FinancialReport>, { ok: true }> => result.ok
  );
  const priority = successes.map((result) => result.provenance.providerId);
  const byFact = new Map<string, { metric: string; period: string; candidates: FinancialFactCandidate[] }>();
  for (const result of successes) {
    const report = result.data;
    for (const statementKind of ['IS', 'BS', 'CF'] as const) {
      const statement = report.statements[statementKind];
      if (!statement) continue;
      for (const indicator of statement.indicators) {
        for (const account of indicator.accounts) {
          const metric = `${statementKind}.${account.field}`;
          for (const value of account.values) {
            const period = `${value.year}:${value.period}`;
            const key = JSON.stringify([metric, period]);
            const fact = byFact.get(key) ?? { metric, period, candidates: [] };
            fact.candidates.push({
              provider: result.provenance.providerId,
              instrument: report.instrumentId ?? report.symbol,
              metric,
              value: value.value,
              asOf: value.fpEnd * 1000,
              period: `${report.report}:${period}`,
              currency: account.percent ? undefined : indicator.currency,
              unit: account.percent ? 'percent' : 'currency',
              adjustment: 'reported',
            });
            byFact.set(key, fact);
          }
        }
      }
    }
  }

  const comparisons = [...byFact.values()].map(({ metric, period, candidates }) => {
    const overrides = policyForMetric(metric);
    const policy: ReconciliationPolicy = {
      version: 'folio-financial-report/v1',
      absoluteTolerance: 0,
      providerPriority: priority,
      maxAsOfSkewMs: 24 * 60 * 60 * 1000,
      requireAsOfCalendarDate: true,
      requireCurrency: candidates[0]?.unit === 'currency',
      ...overrides,
    };
    return { metric, period, result: reconcileFinancialFacts(candidates, policy) };
  });
  return { selected: successes[0], comparisons };
}

/** Resolve dated balance-sheet FX only; flow statements need a period rate. */
export async function reconcileFinancialReportResultsWithFx(
  results: ProviderResult<FinancialReport>[],
  policyForMetric: (metric: string) => Partial<ReconciliationPolicy>,
  resolveCurrency: (from: string, to: string, asOf: number) => Promise<ReconciliationConversion | undefined>
): Promise<FinancialReportReconciliation> {
  const initial = reconcileFinancialReportResults(results, policyForMetric);
  const rates = new Map<string, Promise<ReconciliationConversion | undefined>>();
  const comparisons = await Promise.all(initial.comparisons.map(async (comparison) => {
    const { candidates } = comparison.result;
    const target = candidates[0];
    if (!comparison.metric.startsWith('BS.') || candidates.length < 2
      || !target?.currency || target.asOf === undefined || !Number.isFinite(target.asOf)
      || candidates.some((candidate) => !candidate.currency || candidate.asOf === undefined
        || !Number.isFinite(candidate.asOf))) {
      return comparison;
    }
    const conversions = await Promise.all(candidates.slice(1)
      .filter((candidate) => candidate.currency !== target.currency)
      .map((candidate) => {
        const from = candidate.currency!;
        const to = target.currency!;
        const asOf = candidate.asOf!;
        const key = `${from}:${to}:${new Date(asOf).toISOString().slice(0, 10)}`;
        let rate = rates.get(key);
        if (!rate) {
          rate = resolveCurrency(from, to, asOf);
          rates.set(key, rate);
        }
        return rate;
      }));
    const available = conversions.filter(
      (conversion): conversion is ReconciliationConversion => conversion !== undefined
    );
    if (available.length === 0) return comparison;
    const overrides = policyForMetric(comparison.metric);
    const result = reconcileFinancialFacts(candidates, {
      version: 'folio-financial-report-fx/v1',
      absoluteTolerance: 0,
      providerPriority: [...new Set(candidates.map((candidate) => candidate.provider))],
      maxAsOfSkewMs: 24 * 60 * 60 * 1000,
      requireAsOfCalendarDate: true,
      requireCurrency: true,
      ...overrides,
      currencyConversions: [...(overrides.currencyConversions ?? []), ...available],
      maxConversionSkewMs: overrides.maxConversionSkewMs ?? 4 * 24 * 60 * 60 * 1000,
    });
    return { ...comparison, result };
  }));
  return { ...initial, comparisons };
}
