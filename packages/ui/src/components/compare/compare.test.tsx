import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Provider, createStore } from 'jotai';
import type { Comparison, ComparisonCell } from '@finagent/core';
import { installHappyDom } from '../../test/setupHappyDom';
import { TestI18n } from '../../test/testI18n';
import { compareSymbolsAtom, comparisonStateAtom } from '../../atoms/compareAtoms';
import { FinagentClientProvider, fallbackClient } from '../../client';

let restore: () => void;
let CompareTable: typeof import('./CompareTable')['CompareTable'];
let CompareWorkspace: typeof import('./CompareWorkspace')['CompareWorkspace'];
beforeAll(async () => {
  restore = installHappyDom().restore;
  ({ CompareTable } = await import('./CompareTable'));
  ({ CompareWorkspace } = await import('./CompareWorkspace'));
});
afterAll(() => restore());

const MASSIVE_PROVENANCE = {
  provider: 'massive',
  providerId: 'massive',
  providerName: 'Massive',
  fetchedAt: 1_710_000_000_123,
  marketTime: 1_710_000_000_000,
  delayed: true,
  stale: false,
  failoverTrail: [
    { providerId: 'longbridge', code: 'TIMEOUT', kind: 'timeout', attempts: 1, at: 1_710_000_000_100 },
  ],
};

const LONGBRIDGE_PROVENANCE = {
  provider: 'longbridge',
  providerName: 'Longbridge',
  fetchedAt: 1_710_000_001_000,
  stale: false,
};

function comparisonWith(cells: Record<string, ComparisonCell>): Comparison {
  return {
    symbols: ['AAPL.US', 'MSFT.US'],
    rows: [{ metric: 'Price', cells }],
    generatedAt: 1_710_000_002_000,
    errors: {},
  };
}

async function renderWith(ui: React.ReactElement): Promise<{ container: HTMLDivElement; root: Root }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<TestI18n>{ui}</TestI18n>);
  });
  return { container, root };
}

async function cleanup(root: Root, container: HTMLDivElement): Promise<void> {
  await act(async () => root.unmount());
  container.remove();
}

describe('CompareTable cell provenance (#332)', () => {
  it('describes the actual source in each cell tooltip, unknown when unstamped', async () => {
    const comparison = comparisonWith({
      'AAPL.US': { value: 100, missing: false, display: '$100.00', provenance: MASSIVE_PROVENANCE },
      'MSFT.US': { missing: true, display: '—' },
    });
    const { container, root } = await renderWith(<CompareTable comparison={comparison} />);
    try {
      const tds = Array.from(container.querySelectorAll('tbody td[title]'));
      expect(tds).toHaveLength(2);
      const aaplTitle = tds[0].getAttribute('title') ?? '';
      expect(aaplTitle).toContain('Source: Massive');
      expect(aaplTitle).toContain('Delayed');
      expect(aaplTitle).toContain('Failover: longbridge → Massive');
      // A cell without provenance shows unknown, never an assumed provider.
      expect(tds[1].getAttribute('title')).toContain('Source: Unknown');
    } finally {
      await cleanup(root, container);
    }
  });

  it('renders the selected cell source detail on click and clears on toggle', async () => {
    const comparison = comparisonWith({
      'AAPL.US': { value: 100, missing: false, display: '$100.00', provenance: MASSIVE_PROVENANCE },
      'MSFT.US': { missing: true, display: '—' },
    });
    const { container, root } = await renderWith(<CompareTable comparison={comparison} />);
    try {
      expect(container.querySelector('[data-testid="compare-cell-detail"]')).toBeNull();
      const tds = Array.from(container.querySelectorAll('tbody td[title]'));
      await act(async () => {
        tds[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      const detail = container.querySelector('[data-testid="compare-cell-detail"]');
      expect(detail?.textContent ?? '').toContain('Price · AAPL.US');
      expect(detail?.textContent ?? '').toContain('Source: Massive');
      // Clicking the same cell again clears the detail.
      await act(async () => {
        tds[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(container.querySelector('[data-testid="compare-cell-detail"]')).toBeNull();
      // The unstamped missing cell answers unknown.
      await act(async () => {
        tds[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(container.querySelector('[data-testid="compare-cell-detail"]')?.textContent ?? '').toContain(
        'Source: Unknown'
      );
    } finally {
      await cleanup(root, container);
    }
  });
});

describe('CompareWorkspace header source summary (#332)', () => {
  // The comparison state is injected directly: `compareSymbolsAtom` stays
  // empty so the load effect never fires. (Rendering the load path standalone
  // currently re-renders without settling — the effect's `build` dependency
  // captures `t` from useTranslation. Pre-existing on upstream/main, tracked
  // in the PR notes, out of scope for the provenance change.)
  async function renderWorkspaceWith(data: Comparison): Promise<{ container: HTMLDivElement; root: Root }> {
    const store = createStore();
    store.set(comparisonStateAtom, { data, loading: false, error: null });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <TestI18n>
          <Provider store={store}>
            <FinagentClientProvider client={fallbackClient}>
              <CompareWorkspace />
            </FinagentClientProvider>
          </Provider>
        </TestI18n>
      );
    });
    return { container, root };
  }

  it('names the single actual provider instead of a hardcoded badge', async () => {
    const { container, root } = await renderWorkspaceWith(
      comparisonWith({
        'AAPL.US': { value: 100, missing: false, display: '$100.00', provenance: MASSIVE_PROVENANCE },
        'MSFT.US': { value: 90, missing: false, display: '$90.00', provenance: MASSIVE_PROVENANCE },
      })
    );
    try {
      const header = container.querySelector('[data-testid="compare-workspace"]')?.textContent ?? '';
      expect(header).toContain('Massive');
      expect(header).not.toContain('Longbridge ·');
    } finally {
      await cleanup(root, container);
    }
  });

  it('labels a mixed-source table as mixed instead of one provider', async () => {
    const { container, root } = await renderWorkspaceWith(
      comparisonWith({
        'AAPL.US': { value: 100, missing: false, display: '$100.00', provenance: MASSIVE_PROVENANCE },
        'MSFT.US': { value: 90, missing: false, display: '$90.00', provenance: LONGBRIDGE_PROVENANCE },
      })
    );
    try {
      const header = container.querySelector('[data-testid="compare-workspace"]')?.textContent ?? '';
      expect(header).toContain('Mixed sources');
    } finally {
      await cleanup(root, container);
    }
  });

  it('shows no provider name when no cell carries provenance', async () => {
    const { container, root } = await renderWorkspaceWith(
      comparisonWith({
        'AAPL.US': { value: 100, missing: false, display: '$100.00' },
        'MSFT.US': { value: 90, missing: false, display: '$90.00' },
      })
    );
    try {
      const header = container.querySelector('[data-testid="compare-workspace"]')?.textContent ?? '';
      expect(header).not.toContain('Longbridge');
      expect(header).not.toContain('Massive');
      expect(header).not.toContain('Mixed sources');
    } finally {
      await cleanup(root, container);
    }
  });
});
