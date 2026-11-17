import type { HeatmapSourceSnapshot } from '@finagent/core';
import type { PortfolioView } from '../../atoms/portfolioAtoms';

function revisionOf(value: unknown): string {
  const serialized = JSON.stringify(value);
  let first = 2166136261;
  let second = 5381;
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 33);
  }
  return `v1-${serialized.length}-${(first >>> 0).toString(16)}${(second >>> 0).toString(16)}`;
}

export function watchlistHeatmapSource(symbols: string[]): HeatmapSourceSnapshot {
  const entries = [...new Set(symbols)].map((symbol) => ({ symbol }));
  const revision = revisionOf(entries);
  return { schemaVersion: 1, kind: 'watchlist', id: 'watchlist', revision, capturedAt: Date.now(), entries };
}

export function portfolioHeatmapSource(view: PortfolioView, accountId: string | null): HeatmapSourceSnapshot {
  const entries = view.holdings.map((holding) => ({ symbol: holding.symbol, holding }));
  const revision = revisionOf({ fetchedAt: view.snapshot.fetchedAt, accountId, entries, baseCurrency: view.baseCurrency, valuationCurrency: view.snapshot.baseCurrency });
  return {
    schemaVersion: 1,
    kind: 'portfolio',
    id: `portfolio:${revisionOf(accountId ?? 'all')}`,
    revision,
    capturedAt: view.snapshot.fetchedAt,
    baseCurrency: view.baseCurrency,
    valuationCurrency: view.snapshot.baseCurrency,
    entries,
  };
}
