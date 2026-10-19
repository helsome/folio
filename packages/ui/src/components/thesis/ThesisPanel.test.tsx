import { afterAll, beforeAll, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider, createStore } from 'jotai';
import type { InvestmentThesis, ResearchReport } from '@finagent/core';
import { installHappyDom } from '../../test/setupHappyDom';
import { TestI18n } from '../../test/testI18n';
import { activeSymbolAtom, selectedThesisIdAtom } from '../../atoms/workspaceAtoms';

let restore: () => void;
let ThesisPanel: typeof import('./ThesisPanel')['ThesisPanel'];
beforeAll(async () => {
  restore = installHappyDom().restore;
  ({ ThesisPanel } = await import('./ThesisPanel'));
});
afterAll(() => restore());

const SYMBOL = 'NVDA.US';
const NO_REPORT_COPY = 'No research report yet. Run Deep Research for NVDA.US to save a thesis.';

const REPORT: ResearchReport = {
  id: 'report-1',
  symbol: SYMBOL,
  generatedAt: 1,
  summary: 'AI demand keeps compounding.',
  stance: 'bullish',
  confidence: 0.7,
  sections: [],
  bullCase: [],
  bearCase: [],
  catalysts: [],
  risks: [],
  capabilityRuns: [],
  runStatus: 'completed',
};

const THESIS: InvestmentThesis = {
  id: 'thesis-1',
  symbol: SYMBOL,
  stance: 'bullish',
  summary: 'Buy the AI capex cycle.',
  bullCase: [],
  bearCase: [],
  catalysts: [],
  risks: [],
  evidenceRefs: [],
  createdAt: 1,
  updatedAt: 1,
  lastReviewedAt: 1,
};

/** Renders ThesisPanel against a stubbed `window.electronAPI.thesis` channel. */
async function renderThesisPanel(report: ResearchReport | null) {
  const thesis = {
    list: async () => ({ ok: true as const, data: [THESIS] }),
    getReport: async () => ({ ok: true as const, data: report }),
    listImpacts: async () => ({ ok: true as const, data: [] }),
  };
  (window as unknown as { electronAPI: unknown }).electronAPI = { thesis };

  const store = createStore();
  store.set(activeSymbolAtom, SYMBOL);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <TestI18n>
        <Provider store={store}>
          <ThesisPanel />
        </Provider>
      </TestI18n>
    );
    await new Promise((r) => setTimeout(r, 25));
  });

  return {
    container,
    cleanup: async () => {
      await act(async () => root.unmount());
      container.remove();
      delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    },
  };
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

it('never claims a report is missing once one exists', async () => {
  const { container, cleanup } = await renderThesisPanel(REPORT);
  try {
    // The report gates "Save as Thesis"; the same view must not assert the
    // opposite of that gate in its header.
    expect(container.textContent).toContain('Save as Thesis');
    expect(occurrences(container.textContent ?? '', NO_REPORT_COPY)).toBe(0);
  } finally {
    await cleanup();
  }
});

it('shows the no-report prompt exactly once when there is no report', async () => {
  const { container, cleanup } = await renderThesisPanel(null);
  try {
    expect(occurrences(container.textContent ?? '', NO_REPORT_COPY)).toBe(1);
  } finally {
    await cleanup();
  }
});

it('re-evaluate binds the clicked thesis id and updates by the returned one (#326)', async () => {
  const calls: Array<{ symbol: string; thesisId?: string }> = [];
  const impact = {
    id: 'impact-1',
    thesisId: 'thesis-1',
    symbol: SYMBOL,
    evaluatedAt: 2,
    kind: 'strengthened',
    summary: 'Thesis holds.',
    thesis: { ...THESIS, updatedAt: 2, lastReviewedAt: 2 },
  };
  const thesis = {
    list: async () => ({ ok: true as const, data: [THESIS] }),
    getReport: async () => ({ ok: true as const, data: REPORT }),
    listImpacts: async () => ({ ok: true as const, data: [] }),
    reEvaluate: async (input: { symbol: string; thesisId?: string }) => {
      calls.push(input);
      return { ok: true as const, data: impact };
    },
  };
  (window as unknown as { electronAPI: unknown }).electronAPI = { thesis };
  const store = createStore();
  store.set(activeSymbolAtom, SYMBOL);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <TestI18n>
          <Provider store={store}>
            <ThesisPanel />
          </Provider>
        </TestI18n>
      );
      await new Promise((r) => setTimeout(r, 25));
    });
    const button = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Re-evaluate'
    );
    expect(button).toBeDefined();
    await act(async () => {
      button!.click();
      await new Promise((r) => setTimeout(r, 10));
    });
    // The manual action carries the clicked thesis's id end to end.
    expect(calls).toEqual([{ symbol: SYMBOL, thesisId: 'thesis-1' }]);
    expect(store.get(selectedThesisIdAtom)).toBe('thesis-1');
    // The card updates from the impact's real thesis id.
    expect(container.textContent).toContain('Re-evaluation complete');
  } finally {
    await act(async () => root.unmount());
    container.remove();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  }
});
