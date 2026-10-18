import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createStore, Provider } from 'jotai';
import { DEFAULT_INSTRUMENT_CATALOG, type HeatmapSnapshot, type HeatmapSourceSnapshot, type HeatmapTile } from '@finagent/core';
import { fallbackClient, FinagentClientProvider, type FinagentClient } from '../../client';
import { installHappyDom } from '../../test/setupHappyDom';
import { makeTestI18n, I18nextProvider } from '../../test/i18nTest';
import { HeatmapPanel, heatmapRectangles } from './HeatmapPanel';
import { watchlistHeatmapSource } from './heatmapSource';
import { activeSymbolAtom } from '../../atoms';

let restoreDom: (() => void) | undefined;
beforeAll(() => { restoreDom = installHappyDom().restore; });
afterAll(() => { restoreDom?.(); });

const instrument = DEFAULT_INSTRUMENT_CATALOG.find((item) => item.instrumentId === 'XNAS:AAPL')!;
const source: HeatmapSourceSnapshot = {
  schemaVersion: 1,
  id: 'watchlist:AAPL.US',
  revision: 'AAPL.US',
  kind: 'watchlist',
  capturedAt: Date.now(),
  entries: [{ symbol: 'AAPL.US' }],
};
const tile: HeatmapTile = {
  instrument,
  workspaceSymbol: 'AAPL.US',
  industry: { name: 'Technology', classification: 'SIC', code: '3571' },
  changePercent: 1.2,
  state: 'current',
  provenance: { providerId: 'fixture', providerName: 'Fixture', instrumentId: instrument.instrumentId, fetchedAt: Date.now(), marketTime: Date.now(), stale: false },
  session: 'Open', valueBase: null, weight: null,
};
const snapshot: HeatmapSnapshot = {
  schemaVersion: 1,
  source: { schemaVersion: 1, id: source.id, revision: source.revision, kind: source.kind, capturedAt: source.capturedAt },
  fetchedAt: Date.now(), tiles: [tile], unresolved: [], weightedAvailable: false,
};

function createClient(onLoad: () => HeatmapSnapshot): FinagentClient {
  return {
    ...fallbackClient,
    market: {
      ...fallbackClient.market,
      getHeatmap: async () => ({ ok: true, data: onLoad() }),
    },
  };
}

async function mountPanel(client: FinagentClient, initialSource = source) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const i18n = makeTestI18n('en-US');
  const store = createStore();
  const render = async (nextSource: HeatmapSourceSnapshot) => {
    await act(async () => root.render(
      <I18nextProvider i18n={i18n}>
        <Provider store={store}><FinagentClientProvider client={client}>
          <HeatmapPanel source={nextSource} onResearch={() => undefined} />
        </FinagentClientProvider></Provider>
      </I18nextProvider>,
    ));
  };
  await render(initialSource);
  return { host, render, store, close: async () => { await act(async () => root.unmount()); host.remove(); } };
}

async function flushAsync(): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

describe('HeatmapPanel', () => {
  it('keeps a 100-symbol versioned snapshot compact enough for IPC', () => {
    const source = watchlistHeatmapSource(Array.from({ length: 100 }, (_, index) => `T${index}.US`));
    expect(source.entries).toHaveLength(100);
    expect(source.revision.length).toBeLessThan(64);
    expect(source.id.length).toBeLessThan(256);
  });

  it('lays out 100 fixture symbols through the renderer treemap deterministically', () => {
    const tiles: HeatmapTile[] = Array.from({ length: 100 }, (_, index) => ({
      ...tile,
      instrument: {
        ...instrument,
        instrumentId: `XNAS:FIX${index}`,
        symbol: `FIX${index}`,
        name: `Fixture Security ${index}`,
      },
      workspaceSymbol: `FIX${index}.US`,
      industry: { name: `Industry ${index % 5}`, classification: 'SIC', code: `35${index % 10}1` },
      changePercent: (index % 9) - 4,
      weight: 0.01,
    }));
    const started = performance.now();
    const layout = heatmapRectangles({ ...snapshot, tiles }, 'equal', 960, 360);
    console.info(`heatmap renderer benchmark: 100 fixture securities, ${layout.tiles.length} rectangles, ${(performance.now() - started).toFixed(1)}ms`);
    expect(layout.tiles).toHaveLength(100);
    expect(layout.groups).toHaveLength(10);
    expect(layout.tiles.every((item) => item.x >= 0 && item.y >= 0 && item.x + item.width <= 960.01 && item.y + item.height <= 360.01)).toBe(true);
  });

  it('renders a focusable canonical instrument and enters company research', async () => {
    let requests = 0;
    const researched: string[] = [];
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(
      <I18nextProvider i18n={makeTestI18n('en-US')}>
        <FinagentClientProvider client={createClient(() => { requests += 1; return snapshot; })}>
          <HeatmapPanel source={source} onResearch={(item) => researched.push(item.workspaceSymbol)} />
        </FinagentClientProvider>
      </I18nextProvider>,
    ));
    await flushAsync();
    const button = host.querySelector('[data-testid="heatmap-tile-AAPL"]') as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button.tabIndex).toBe(0);
    await act(async () => { button.focus(); button.click(); });
    expect(researched).toEqual(['AAPL.US']);
    expect(requests).toBe(1);
    await act(async () => root.unmount());
    host.remove();
  });

  it('retains the selected canonical instrument after a refresh and exposes the table view', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(
      <I18nextProvider i18n={makeTestI18n('zh-CN')}>
        <FinagentClientProvider client={createClient(() => snapshot)}>
          <HeatmapPanel source={source} onResearch={() => undefined} />
        </FinagentClientProvider>
      </I18nextProvider>,
    ));
    await flushAsync();
    const tileButton = host.querySelector('[data-testid="heatmap-tile-AAPL"]') as HTMLButtonElement;
    await act(async () => tileButton.click());
    expect(host.querySelector('[data-testid="heatmap-detail"]')?.textContent).toContain('AAPL.US');
    const tableButton = Array.from(host.querySelectorAll('button')).find((button) => button.getAttribute('aria-label') === '表格')!;
    await act(async () => tableButton.click());
    expect(host.querySelector('[data-testid="heatmap-table"]')?.textContent).toContain('AAPL.US');
    const refreshButton = Array.from(host.querySelectorAll('button')).find((button) => button.getAttribute('aria-label') === '刷新热力图')!;
    await act(async () => refreshButton.click());
    await flushAsync();
    expect(host.querySelector('[data-testid="heatmap-detail"]')?.textContent).toContain('AAPL.US');
    await act(async () => root.unmount());
    host.remove();
  });

  it('shows ratio weights as percentages in tooltips, details, and the same snapshot table', async () => {
    const panel = await mountPanel(createClient(() => ({ ...snapshot, tiles: [{ ...tile, weight: 0.25 }] })));
    const button = panel.host.querySelector('[data-testid="heatmap-tile-AAPL"]') as HTMLButtonElement;
    expect(button.title).toContain('25%');
    await act(async () => button.click());
    expect(panel.host.querySelector('[data-testid="heatmap-detail"]')?.textContent).toContain('25%');
    await act(async () => (panel.host.querySelector('[aria-label="Table"]') as HTMLButtonElement).click());
    expect(panel.host.querySelector('[data-testid="heatmap-table"]')?.textContent).toContain('25%');
    await panel.close();
  });

  it('hides previous membership during a source change and ignores a cancelled late response', async () => {
    const pending = new Map<string, (data: HeatmapSnapshot) => void>();
    const cancelled: string[] = [];
    const client: FinagentClient = { ...fallbackClient, market: {
      ...fallbackClient.market,
      getHeatmap: ({ source }) => new Promise((resolve) => {
        pending.set(source.revision, (data) => resolve({ ok: true, data }));
      }),
      cancelHeatmap: async (id) => { cancelled.push(id); return { ok: true, data: undefined }; },
    } };
    const panel = await mountPanel(client);
    await act(async () => pending.get(source.revision)!(snapshot));
    expect(panel.host.querySelector('[data-testid="heatmap-tile-AAPL"]')).not.toBeNull();
    await panel.render({ ...source, revision: 'rev-2' });
    expect(panel.host.querySelector('[data-testid="heatmap-tile-AAPL"]')).toBeNull();
    await panel.render({ ...source, revision: 'rev-3' });
    await act(async () => pending.get('rev-2')!({ ...snapshot, source: { ...snapshot.source, revision: 'rev-2' } }));
    expect(panel.host.querySelector('[data-testid="heatmap-tile-AAPL"]')).toBeNull();
    await act(async () => pending.get('rev-3')!({ ...snapshot, source: { ...snapshot.source, revision: 'rev-3' }, tiles: [] }));
    expect(panel.host.textContent).toContain('No instruments in this snapshot.');
    expect(cancelled).toHaveLength(2);
    await panel.close();
  });

  it('uses the shared workspace selection as the single map/table selection', async () => {
    const nvidia = DEFAULT_INSTRUMENT_CATALOG.find((item) => item.instrumentId === 'XNAS:NVDA')!;
    const panel = await mountPanel(createClient(() => ({ ...snapshot, tiles: [tile, { ...tile, instrument: nvidia, workspaceSymbol: 'NVDA.US' }] })));
    await act(async () => (panel.host.querySelector('[data-testid="heatmap-tile-AAPL"]') as HTMLButtonElement).click());
    await act(async () => panel.store.set(activeSymbolAtom, 'NVDA.US'));
    expect(panel.host.querySelectorAll('[data-testid^="heatmap-tile-"][aria-pressed="true"]')).toHaveLength(1);
    expect(panel.host.querySelector('[data-testid="heatmap-detail"]')?.textContent).toContain('NVDA.US');
    await act(async () => (panel.host.querySelector('[aria-label="Table"]') as HTMLButtonElement).click());
    expect(panel.host.querySelector('[data-testid="heatmap-table"] [aria-pressed="true"]')?.textContent).toContain('NVDA.US');
    await panel.close();
  });

  it('rejects mismatched snapshots and displays unavailable data without fabricated tiles', async () => {
    const mismatch = await mountPanel(createClient(() => ({ ...snapshot, source: { ...snapshot.source, revision: 'wrong' } })));
    expect(mismatch.host.querySelector('[role="alert"]')?.textContent).toContain('changed during refresh');
    expect(mismatch.host.querySelector('[data-testid="heatmap-tile-AAPL"]')).toBeNull();
    await mismatch.close();
    const unavailable = await mountPanel({ ...fallbackClient, market: {
      ...fallbackClient.market,
      getHeatmap: async () => { throw new Error('Provider unavailable'); },
    } });
    expect(unavailable.host.querySelector('[role="alert"]')?.textContent).toBe('Provider unavailable');
    expect(unavailable.host.querySelector('[data-testid="heatmap-tile-AAPL"]')).toBeNull();
    await unavailable.close();
  });

  it('retains stale returns as labeled gray data and groups missing industry separately', async () => {
    const panel = await mountPanel(createClient(() => ({ ...snapshot, tiles: [{ ...tile, state: 'stale', industry: undefined }] })));
    const button = panel.host.querySelector('[data-testid="heatmap-tile-AAPL"]') as HTMLButtonElement;
    expect(button.textContent).toContain('Stale');
    expect(button.textContent).toContain('1.2%');
    expect(button.style.backgroundColor).toBe('#6b7280');
    expect(panel.host.textContent).toContain('Unknown industry');
    await panel.close();
  });
});
