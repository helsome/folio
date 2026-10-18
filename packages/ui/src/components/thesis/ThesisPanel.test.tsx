import { afterAll, beforeAll, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider, createStore } from 'jotai';
import type { InvestmentThesis, ResearchReport } from '@finagent/core';
import { installHappyDom } from '../../test/setupHappyDom';
import { TestI18n } from '../../test/testI18n';
import { activeSymbolAtom } from '../../atoms/workspaceAtoms';

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
async function renderThesisPanel(
  report: ResearchReport | null,
  overrides: Record<string, unknown> = {}
) {
  const thesis = {
    list: async () => ({ ok: true as const, data: [THESIS] }),
    getReport: async () => ({ ok: true as const, data: report }),
    listImpacts: async () => ({ ok: true as const, data: [] }),
    ...overrides,
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

it('re-evaluates the thesis the user clicked and updates that card', async () => {
  const newer: InvestmentThesis = {
    ...THESIS,
    id: 'thesis-2',
    summary: 'A different, newer view of the same symbol.',
  };
  const payloads: unknown[] = [];
  const { container, cleanup } = await renderThesisPanel(REPORT, {
    list: async () => ({ ok: true as const, data: [THESIS, newer] }),
    reEvaluate: async (payload: unknown) => {
      payloads.push(payload);
      return {
        ok: true as const,
        data: {
          id: 'impact-1',
          thesisId: THESIS.id,
          symbol: SYMBOL,
          evaluatedAt: 2,
          kind: 'unchanged',
          summary: 'Still fine.',
          evidence: [],
          thesis: { ...THESIS, summary: 'Re-evaluated the selected thesis.' },
        },
      };
    },
  });
  try {
    const button = Array.from(container.querySelectorAll('button')).find((el) =>
      (el.textContent ?? '').includes('Re-evaluate')
    );
    expect(button).toBeDefined();
    await act(async () => {
      button?.click();
      await new Promise((r) => setTimeout(r, 25));
    });

    // The selected thesis travels with the request...
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({ symbol: SYMBOL, thesisId: THESIS.id });
    // ...and the card that changes is the one the result belongs to.
    expect(container.textContent).toContain('Re-evaluated the selected thesis.');
    expect(container.textContent).toContain('A different, newer view of the same symbol.');
  } finally {
    await cleanup();
  }
});
