import { afterAll, beforeAll, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider, createStore } from 'jotai';
import type { ResearchReport, ResearchRunSummary } from '@finagent/core';
import { installHappyDom } from '../../test/setupHappyDom';
import { TestI18n } from '../../test/testI18n';
import { FinagentClientProvider, fallbackClient } from '../../client';
import { activeSymbolAtom, selectedReportIdAtom } from '../../atoms/workspaceAtoms';
import { pendingResearchReportIdAtom, researchReportAtom } from '../../atoms/researchAtoms';

let restore: () => void;
let ResearchPanel: typeof import('./ResearchPanel')['ResearchPanel'];
beforeAll(async () => {
  restore = installHappyDom().restore;
  ({ ResearchPanel } = await import('./ResearchPanel'));
});
afterAll(() => restore());

it('hydrates an interrupted run, exposes recovery actions, and shows a resume error', async () => {
  const run: ResearchRunSummary = {
    id: 'saved-run', symbol: 'NVDA.US', status: 'interrupted', startedAt: 1,
    plannedCapabilities: ['research.news'], completedCapabilities: ['research.news'],
    failedCapabilities: [], recoverable: true,
  };
  let resumed = '';
  const research = {
    ...fallbackClient.research!,
    listRuns: async () => ({ ok: true as const, data: [run] }),
    listReports: async () => ({ ok: true as const, data: [] }),
    resume: async ({ runId }: { runId: string }) => {
      resumed = runId;
      return { ok: false as const, error: { code: 'RESEARCH_IDENTITY_CHANGED', message: 'Restore the original model.' } };
    },
  };
  (window as unknown as { electronAPI: unknown }).electronAPI = { research };
  const store = createStore();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(<TestI18n><Provider store={store}>
        <FinagentClientProvider client={{ ...fallbackClient, research }}><ResearchPanel /></FinagentClientProvider>
      </Provider></TestI18n>);
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(store.get(activeSymbolAtom)).toBe('NVDA.US');
    const card = container.querySelector('[data-testid="research-recovery"]')!;
    expect(card.textContent).toContain('1 completed results saved');
    const buttons = Array.from(card.querySelectorAll('button'));
    expect(buttons.map((b) => b.textContent)).toEqual(['Resume', 'Restart from scratch', 'Discard run']);
    await act(async () => { buttons[0].click(); await new Promise((r) => setTimeout(r, 5)); });
    expect(resumed).toBe(run.id);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Restore the original model.');
  } finally {
    await act(async () => root.unmount());
    container.remove();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  }
});

const REPORT: ResearchReport = {
  id: 'report-shown',
  symbol: 'NVDA.US',
  generatedAt: 1,
  summary: 'NVDA leads the AI compute build-out.',
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

function stubResearch(overrides: Record<string, unknown> = {}) {
  const research = {
    ...fallbackClient.research!,
    listRuns: async () => ({ ok: true as const, data: [] }),
    listReports: async () => ({ ok: true as const, data: [] }),
    getDiff: async () => ({ ok: true as const, data: undefined }),
    ...overrides,
  } as typeof fallbackClient.research & Record<string, unknown>;
  (window as unknown as { electronAPI: unknown }).electronAPI = { research };
  return research;
}

async function renderPanel(store: ReturnType<typeof createStore>) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <TestI18n>
        <Provider store={store}>
          <FinagentClientProvider client={fallbackClient}>
            <ResearchPanel />
          </FinagentClientProvider>
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

it('deep link opens the exact reportId instead of re-resolving latest (#327/#331)', async () => {
  const oldReport = { ...REPORT, id: 'report-old' };
  const requested: Array<{ reportId: string }> = [];
  stubResearch({
    getReport: async (input: { reportId: string }) => {
      requested.push(input);
      return { ok: true as const, data: oldReport };
    },
  });
  const store = createStore();
  store.set(activeSymbolAtom, 'NVDA.US');
  store.set(pendingResearchReportIdAtom, 'report-old');
  const { cleanup } = await renderPanel(store);
  try {
    expect(requested).toEqual([{ reportId: 'report-old' }]);
    expect(store.get(researchReportAtom)?.id).toBe('report-old');
    // The shown version becomes the workspace selection identity.
    expect(store.get(selectedReportIdAtom)).toBe('report-old');
    // The intent is consumed exactly once.
    expect(store.get(pendingResearchReportIdAtom)).toBeNull();
  } finally {
    await cleanup();
  }
});

it('clears a report left over from another symbol on symbol switch (#331)', async () => {
  stubResearch();
  const store = createStore();
  store.set(activeSymbolAtom, 'MSFT.US');
  store.set(researchReportAtom, { ...REPORT, id: 'report-aapl', symbol: 'AAPL.US' });
  store.set(selectedReportIdAtom, 'report-aapl');
  const { cleanup } = await renderPanel(store);
  try {
    expect(store.get(researchReportAtom)).toBeNull();
    expect(store.get(selectedReportIdAtom)).toBeNull();
  } finally {
    await cleanup();
  }
});

it('save-as-thesis persists exactly the shown report version (#327)', async () => {
  stubResearch();
  const saves: Array<{ symbol: string; reportId?: string }> = [];
  const thesis = {
    list: async () => ({ ok: true as const, data: [] }),
    saveFromReport: async (input: { symbol: string; reportId?: string }) => {
      saves.push(input);
      return { ok: true as const, data: { id: 'thesis-new' } };
    },
  };
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    research: (window as unknown as { electronAPI: { research: unknown } }).electronAPI.research,
    thesis,
  };
  const store = createStore();
  store.set(activeSymbolAtom, 'NVDA.US');
  store.set(researchReportAtom, REPORT);
  const { container, cleanup } = await renderPanel(store);
  try {
    const primary = Array.from(container.querySelectorAll('[data-testid="research-next-action"] button')).find(
      (b) => b.textContent === 'Save as Investment Thesis'
    );
    expect(primary).not.toBeNull();
    await act(async () => {
      (primary as HTMLElement).click();
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(saves).toEqual([{ symbol: 'NVDA.US', reportId: 'report-shown' }]);
  } finally {
    await cleanup();
  }
});
