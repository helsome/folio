import type { ProviderResult, Quote, ReconciliationResult } from '@finagent/core';
import { reconcileFinancialFacts } from '@finagent/core';

export interface QuoteReconciliation {
  selected?: Extract<ProviderResult<Quote>, { ok: true }>;
  comparison: ReconciliationResult;
}

/** Compare quotes only when they describe the same instrument and nearby market time. */
export function reconcileQuoteResults(results: ProviderResult<Quote>[]): QuoteReconciliation {
  const successes = results.filter(
    (result): result is Extract<ProviderResult<Quote>, { ok: true }> => result.ok
  );
  const candidates = successes.map(({ data, provenance }) => ({
    provider: provenance.providerId,
    instrument: data.instrumentId ?? data.symbol,
    metric: 'lastPrice',
    value: data.lastPrice,
    asOf: data.timestamp * 1000,
    period: 'market.quote',
    currency: data.symbol.endsWith('.US') ? 'USD' : undefined,
    unit: 'share',
    adjustment: 'unadjusted',
  }));
  return {
    selected: successes[0],
    comparison: reconcileFinancialFacts(candidates, {
      version: 'folio-quote/v1',
      absoluteTolerance: 0.01,
      relativeTolerance: 0.001,
      maxAsOfSkewMs: 60_000,
      requireCurrency: true,
      providerPriority: successes.map(({ provenance }) => provenance.providerId),
    }),
  };
}
