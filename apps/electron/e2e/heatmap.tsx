import React from 'react';
import { createRoot } from 'react-dom/client';
import { Provider, createStore, useAtomValue, useSetAtom } from 'jotai';
import { I18nextProvider } from 'react-i18next';
import { createSyncI18n } from '@finagent/i18n';
import { DEFAULT_INSTRUMENT_CATALOG, type HeatmapSnapshot, type HeatmapSourceSnapshot } from '@finagent/core';
import { fallbackClient, FinagentClientProvider } from '../../../packages/ui/src/client';
import { activeSymbolAtom, navSectionAtom, selectedPositionAtom } from '../../../packages/ui/src/atoms';
import { researchOriginAtom } from '../../../packages/ui/src/atoms/discoverAtoms';
import { HeatmapPanel } from '../../../packages/ui/src/components/heatmap/HeatmapPanel';
import { ResearchPanel } from '../../../packages/ui/src/components/research/ResearchPanel';
import '../src/renderer/styles/index.css';

// These fixtures use real catalog identities with deliberately synthetic prices/holdings.
const benchmark = new URLSearchParams(location.search).get('count') === '100';
const instruments = benchmark ? Array.from({ length: 100 }, (_, index) => ({
  ...DEFAULT_INSTRUMENT_CATALOG[0]!,
  instrumentId: `XNAS:FIX${index}`, symbol: `FIX${index}`, name: `Fixture Security ${index}`,
  providerAliases: [{ providerId: 'longbridge', symbol: `FIX${index}.US` }],
})) : DEFAULT_INSTRUMENT_CATALOG.slice(0, 6);
const source: HeatmapSourceSnapshot = {
  schemaVersion: 1, id: 'verification-portfolio', revision: 'fixture-1', kind: 'portfolio',
  capturedAt: Date.UTC(2026, 9, 16, 20), baseCurrency: 'USD', valuationCurrency: 'USD',
  entries: instruments.map((instrument) => ({ symbol: instrument.instrumentId })),
};
const snapshot: HeatmapSnapshot = {
  schemaVersion: 1, source, fetchedAt: source.capturedAt, weightedAvailable: true, unresolved: [],
  tiles: instruments.map((instrument, index) => ({
    instrument,
    workspaceSymbol: instrument.providerAliases.find((alias) => alias.providerId === 'longbridge')!.symbol,
    industry: benchmark
      ? { name: `Fixture industry ${index % 5}`, classification: 'SIC', code: `357${index % 5}` }
      : index < 3 ? { name: 'Fixture technology', classification: 'SIC', code: '3571' } : undefined,
    changePercent: [1.2, -2.1, 4.2, -0.5, 0, null][index % 6]!,
    state: index === 5 ? 'unknown' : index === 4 ? 'stale' : 'current',
    session: index === 4 ? 'Closed' : 'Open',
    provenance: { providerId: 'fixture', providerName: 'Fixture provider', instrumentId: instrument.instrumentId, fetchedAt: source.capturedAt, marketTime: source.capturedAt, stale: index === 4, delayed: index === 4 },
    valueBase: benchmark ? 100 : [300, 100, 250, 150, 100, 100][index]!,
    weight: benchmark ? 0.01 : [0.3, 0.1, 0.25, 0.15, 0.1, 0.1][index]!,
  })),
};

const store = createStore();
store.set(navSectionAtom, 'portfolio');
const client = {
  ...fallbackClient,
  market: {
    ...fallbackClient.market,
    getHeatmap: async (input: { source: HeatmapSourceSnapshot }) => ({ ok: true as const, data: { ...snapshot, source: input.source } }),
    cancelHeatmap: async () => ({ ok: true as const, data: undefined }),
    getQuote: async (symbol: string) => ({ ok: true as const, data: { symbol, lastPrice: 100, change: 1, changePercent: 1, timestamp: source.capturedAt / 1000, volume: 1000, high: 101, low: 99, open: 99, prevClose: 99 } }),
    getStaticInfo: async (symbol: string) => ({ ok: true as const, data: { symbol, name: DEFAULT_INSTRUMENT_CATALOG.find((item) => item.providerAliases.some((alias) => alias.symbol === symbol))?.name ?? symbol } }),
    getKline: async () => ({ ok: true as const, data: [] }),
  },
};

function Verification() {
  const nav = useAtomValue(navSectionAtom);
  const setNav = useSetAtom(navSectionAtom);
  const setActiveSymbol = useSetAtom(activeSymbolAtom);
  const setSelectedPosition = useSetAtom(selectedPositionAtom);
  const setOrigin = useSetAtom(researchOriginAtom);
  return <main className="min-h-screen bg-background p-4 text-foreground sm:p-6">
    <header className="mb-5 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
      <strong className="text-[17px]">Folio</strong>
      <span className="text-[11px] text-foreground/58">Fixture data · real catalog instruments · no live provider or model</span>
    </header>
    {nav === 'research' ? <>
      <button type="button" className="mb-3 text-[12px] text-[var(--mac-blue)]" onClick={() => setNav('portfolio')}>Back to heatmap</button>
      <ResearchPanel />
    </> : <HeatmapPanel source={source}
      onSelect={(tile) => { setActiveSymbol(tile.workspaceSymbol); setSelectedPosition(tile.workspaceSymbol); }}
      onResearch={(tile) => { setOrigin({ from: 'portfolio', label: tile.workspaceSymbol }); setNav('research'); }}
    />}
  </main>;
}

createRoot(document.getElementById('root')!).render(
  <Provider store={store}>
    <I18nextProvider i18n={createSyncI18n({ locale: 'en-US' })}>
      <FinagentClientProvider client={client}><Verification /></FinagentClientProvider>
    </I18nextProvider>
  </Provider>,
);
