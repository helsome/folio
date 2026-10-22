import assert from 'node:assert/strict';
import { DEFAULT_INSTRUMENT_CATALOG, InstrumentResolver } from '@finagent/core';
import { buildHeatmapSnapshot } from '../packages/shared/src/heatmap/snapshot.ts';
import { ProviderRouter } from '../packages/shared/src/providers/router.ts';
import { createRouterFetchers, ProviderFetchError } from '../packages/shared/src/providers/router-fetchers.ts';
import { YahooChartFinancialDataProvider } from '../packages/shared/src/providers/yahoo/adapter.ts';

// Opt-in real HTTP; no fixture, account credentials, or connected-status shortcut.
async function main(): Promise<void> {
  const instrument = DEFAULT_INSTRUMENT_CATALOG.find((item) => item.instrumentId === 'XNAS:AAPL')!;
  const router = new ProviderRouter({ timeoutMs: 12_000 });
  router.register(new YahooChartFinancialDataProvider());
  router.setRouting({ primary: 'yahoo' });
  const resolver = new InstrumentResolver(DEFAULT_INSTRUMENT_CATALOG);
  const fetchers = createRouterFetchers(router, { resolve: (symbol) => resolver.resolve(symbol) });
  const quote = await fetchers.getQuoteResult(instrument.instrumentId);
  const profile = await fetchers.getStaticInfo(instrument.instrumentId);
  const snapshot = buildHeatmapSnapshot({
    snapshotId: `yahoo-live-${quote.provenance.fetchedAt}`, mode: 'watchlist',
    // Yahoo's brief StaticInfo has no sector; do not infer one from its name.
    entries: [{ instrument, quote: { ok: true, ...quote } }],
  });
  const cell = snapshot.groups[0].cells[0];
  assert.deepEqual(cell.source, { providerId: 'yahoo', providerName: 'Yahoo Finance', delayed: true });
  assert.equal(cell.quoteStatus, 'delayed');
  assert.equal(cell.sector, null);
  assert.ok(profile.name);
  assert.ok(Number.isFinite(cell.changePercent));
  assert.ok(Number.isFinite(cell.quoteTimestamp));
  assert.ok(Number.isFinite(cell.provenance?.marketTime));
  console.log(JSON.stringify({ live: true, checkedAt: new Date().toISOString(), snapshot }, null, 2));
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ live: true, ok: false,
    code: error instanceof ProviderFetchError ? error.code : 'SMOKE_FAILED',
  }));
  process.exitCode = 1;
});
