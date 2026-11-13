import { afterAll, beforeAll, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider, createStore, useAtomValue } from 'jotai';
import type { ResearchReport, ResearchRunSummary } from '@finagent/core';
import { installHappyDom } from '../../test/setupHappyDom';
import { TestI18n } from '../../test/testI18n';
import { FinagentClientProvider, fallbackClient, type FinagentClient } from '../../client';
import { activeSymbolAtom, navSectionAtom } from '../../atoms/workspaceAtoms';
import { researchReportAtom, researchRunsAtom, selectedReportIdAtom } from '../../atoms/researchAtoms';
import { TodayView } from '../today/TodayView';

let restore: () => void;
let ResearchPanel: typeof import('./ResearchPanel')['ResearchPanel'];
beforeAll(async () => {
  restore = installHappyDom().restore;
  ({ ResearchPanel } = await import('./ResearchPanel'));
});

const makeReport = (id: string, symbol: string, generatedAt: number): ResearchReport => ({
  id, symbol, generatedAt, summary: `Conclusion ${id}`, stance: 'neutral', confidence: 0.5,
  sections: [], bullCase: [], bearCase: [], catalysts: [], risks: [], capabilityRuns: [], runStatus: 'completed',
});
const oldA = makeReport('a-old', 'AAPL.US', Date.UTC(2026, 9, 17, 12));
const newA = makeReport('a-new', 'AAPL.US', Date.UTC(2026, 9, 18, 12));
const onlyB = makeReport('b-only', 'MSFT.US', Date.UTC(2026, 9, 19, 12));
const allReports = [onlyB, newA, oldA];
const allRuns: ResearchRunSummary[] = allReports.map((report) => ({
  id: `run-${report.id}`, symbol: report.symbol, reportId: report.id, status: 'completed',
  startedAt: report.generatedAt, finishedAt: report.generatedAt,
  plannedCapabilities: [], completedCapabilities: [], failedCapabilities: [],
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function flush() {
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
async function mountSelection(overrides: Record<string, unknown> = {}, journey = false, saveResult?: Promise<unknown>) {
  const saves: unknown[] = [];
  const research = {
    listRuns: async () => ({ ok: true, data: allRuns }),
    listReports: async ({ symbol }: { symbol?: string }) => ({ ok: true, data: allReports.filter((r) => !symbol || r.symbol === symbol) }),
    getReport: async ({ reportId }: { reportId: string }) => ({ ok: true, data: allReports.find((r) => r.id === reportId) }),
    getDiff: async () => ({ ok: true, data: undefined }),
    ...overrides,
  };
  (window as unknown as { electronAPI: unknown }).electronAPI = { research, thesis: {
    saveFromReport: async (input: unknown) => { saves.push(input); return saveResult ?? { ok: true, data: { id: 'saved' } }; },
  } };
  const store = createStore();
  store.set(activeSymbolAtom, oldA.symbol);
  store.set(navSectionAtom, journey ? 'today' : 'research');
  const Journey = () => useAtomValue(navSectionAtom) === 'today' ? <TodayView /> : <ResearchPanel />;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = { ...fallbackClient, research: { ...fallbackClient.research!, ...research } } as FinagentClient;
  await act(async () => root.render(<TestI18n><Provider store={store}>
    <FinagentClientProvider client={client}>{journey ? <Journey /> : <ResearchPanel />}</FinagentClientProvider>
  </Provider></TestI18n>));
  await flush();
  return { store, container, saves, cleanup: async () => {
    await act(async () => root.unmount()); container.remove();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    window.localStorage.clear();
  } };
}

it('keeps dated history reachable after a report loads and saves the chosen old version', async () => {
  const { container, saves, cleanup } = await mountSelection();
  try {
    expect(container.textContent).toContain(newA.summary);
    const history = container.querySelector('[data-testid="research-history"]');
    expect(history).not.toBeNull();
    const oldButton = history!.querySelector(`[data-report-id="${oldA.id}"]`) as HTMLButtonElement;
    expect(oldButton.textContent).toContain(new Date(oldA.generatedAt).toLocaleString());
    await act(async () => oldButton.click()); await flush();
    expect(container.textContent).toContain(oldA.summary);
    expect(container.textContent).not.toContain(newA.summary);
    const save = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-testid="research-next-action"] button'))
      .find((button) => button.textContent?.includes('Save as Investment Thesis'))!;
    await act(async () => save.click()); await flush();
    expect(saves).toEqual([{ symbol: oldA.symbol, reportId: oldA.id }]);
  } finally { await cleanup(); }
});

it('does not let a stale history request override a newer same-symbol selection', async () => {
  const late = deferred<unknown>();
  const { store, cleanup } = await mountSelection({
    getReport: ({ reportId }: { reportId: string }) => reportId === oldA.id ? late.promise : Promise.resolve({ ok: true, data: newA }),
  });
  try {
    await act(async () => store.set(selectedReportIdAtom, oldA.id)); await flush();
    await act(async () => store.set(selectedReportIdAtom, newA.id)); await flush();
    await act(async () => late.resolve({ ok: true, data: oldA })); await flush();
    expect(store.get(researchReportAtom)?.id).toBe(newA.id);
    expect(store.get(selectedReportIdAtom)).toBe(newA.id);
  } finally { await cleanup(); }
});

it('discards late report lists from another security', async () => {
  const late = deferred<unknown>();
  const { store, container, cleanup } = await mountSelection({
    listReports: ({ symbol }: { symbol?: string }) => symbol === oldA.symbol ? late.promise : Promise.resolve({ ok: true, data: [onlyB] }),
  });
  try {
    await act(async () => store.set(activeSymbolAtom, onlyB.symbol)); await flush();
    await act(async () => late.resolve({ ok: true, data: [newA, oldA] })); await flush();
    const history = container.querySelector('[data-testid="research-history"]')!;
    expect(history.textContent).toContain(onlyB.symbol);
    expect(history.textContent).not.toContain(oldA.symbol);
    expect(store.get(researchReportAtom)?.id).toBe(onlyB.id);
  } finally { await cleanup(); }
});

it('keeps an unavailable explicit selection without silently opening latest', async () => {
  const { store, container, cleanup } = await mountSelection();
  try {
    await act(async () => store.set(selectedReportIdAtom, 'missing')); await flush();
    expect(store.get(researchReportAtom)).toBeNull();
    expect(store.get(selectedReportIdAtom)).toBe('missing');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('selected report is unavailable');
    expect(container.textContent).not.toContain(newA.summary);
    expect(container.querySelector('[data-testid="research-history"]') !== null).toBe(true);
  } finally { await cleanup(); }
});

it('does not show an old save completion on a different report', async () => {
  const late = deferred<unknown>();
  const { store, container, cleanup } = await mountSelection({}, false, late.promise);
  try {
    const save = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-testid="research-next-action"] button'))
      .find((button) => button.textContent?.includes('Save as Investment Thesis'))!;
    await act(async () => save.click());
    await act(async () => store.set(activeSymbolAtom, onlyB.symbol)); await flush();
    await act(async () => late.resolve({ ok: true, data: { id: 'saved-a' } })); await flush();
    expect(container.querySelector('[data-testid="thesis-saved-banner"]') === null).toBe(true);
    expect(store.get(researchReportAtom)?.id).toBe(onlyB.id);
  } finally { await cleanup(); }
});

it('keeps history accessible during a run and ignores its delayed poll after switching securities', async () => {
  const late = deferred<unknown>();
  const active: ResearchRunSummary = { ...allRuns[1], id: 'running-a', status: 'fetching', reportId: undefined };
  let requested = false;
  const { store, container, cleanup } = await mountSelection({
    listRuns: async () => ({ ok: true, data: [active, ...allRuns] }),
    getRun: () => { requested = true; return late.promise; },
  });
  try {
    expect(container.querySelectorAll('[data-testid="research-history"] button').length).toBe(2);
    await act(async () => store.set(selectedReportIdAtom, oldA.id)); await flush();
    await act(async () => { await new Promise((r) => setTimeout(r, 950)); });
    expect(requested).toBe(true);
    await act(async () => store.set(activeSymbolAtom, onlyB.symbol)); await flush();
    await act(async () => late.resolve({ ok: true, data: { ...active, status: 'completed', reportId: newA.id } })); await flush();
    expect(store.get(researchReportAtom)?.id).toBe(onlyB.id);
    expect(store.get(researchRunsAtom).find((run) => run.id === active.id)?.status).toBe('fetching');
  } finally { await cleanup(); }
});

it('does not replace an explicitly selected historical report when a run completes', async () => {
  const active: ResearchRunSummary = { ...allRuns[1], id: 'running-a', status: 'fetching', reportId: undefined };
  const { store, cleanup } = await mountSelection({
    listRuns: async () => ({ ok: true, data: [active, ...allRuns] }),
    getRun: async () => ({ ok: true, data: { ...active, status: 'completed', reportId: newA.id } }),
  });
  try {
    await act(async () => store.set(selectedReportIdAtom, oldA.id)); await flush();
    await act(async () => { await new Promise((r) => setTimeout(r, 950)); }); await flush();
    expect(store.get(researchReportAtom)?.id).toBe(oldA.id);
  } finally { await cleanup(); }
});

it('finishes a pending start when the user selects another report version', async () => {
  const late = deferred<unknown>();
  const { store, container, cleanup } = await mountSelection({ start: () => late.promise });
  try {
    const start = Array.from(container.querySelectorAll<HTMLButtonElement>('.folio-pilot-research-header button'))
      .find((button) => button.textContent === 'Deep Research')!;
    await act(async () => start.click());
    await act(async () => store.set(selectedReportIdAtom, oldA.id)); await flush();
    await act(async () => late.resolve({ ok: false, error: { code: 'FAILED', message: 'Old start failed' } })); await flush();
    expect(start.disabled).toBe(false);
    expect(start.textContent).toBe('Deep Research');
    expect(store.get(researchReportAtom)?.id).toBe(oldA.id);
  } finally { await cleanup(); }
});

it.each(['resume', 'restart'] as const)('ignores a delayed %s completion after switching securities', async (action) => {
  const late = deferred<unknown>();
  const interrupted: ResearchRunSummary = { ...allRuns[1], id: 'interrupted-a', status: 'interrupted', reportId: undefined, recoverable: true };
  const { store, container, cleanup } = await mountSelection({
    listRuns: async () => ({ ok: true, data: [interrupted, ...allRuns] }), [action]: () => late.promise,
  });
  try {
    const label = action === 'resume' ? 'Resume' : 'Restart from scratch';
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-testid="research-recovery"] button')).find((item) => item.textContent === label)!;
    await act(async () => button.click());
    await act(async () => store.set(activeSymbolAtom, onlyB.symbol)); await flush();
    await act(async () => late.resolve({ ok: true, data: { ...interrupted, status: 'fetching' } })); await flush();
    expect(store.get(activeSymbolAtom)).toBe(onlyB.symbol);
    expect(store.get(selectedReportIdAtom)).toBe(onlyB.id);
    expect(container.textContent).not.toContain(oldA.summary);
  } finally { await cleanup(); }
});

it('continues tracking a resumed run while preserving a newer historical selection', async () => {
  const late = deferred<unknown>();
  const interrupted: ResearchRunSummary = { ...allRuns[1], id: 'interrupted-a', status: 'interrupted', reportId: undefined, recoverable: true };
  let resumed = false;
  const { store, container, cleanup } = await mountSelection({
    listRuns: async () => ({ ok: true, data: [{ ...interrupted, status: resumed ? 'fetching' : 'interrupted' }, ...allRuns] }),
    resume: () => late.promise,
  });
  try {
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-testid="research-recovery"] button')).find((item) => item.textContent === 'Resume')!;
    await act(async () => button.click());
    await act(async () => store.set(selectedReportIdAtom, oldA.id)); await flush();
    resumed = true;
    await act(async () => late.resolve({ ok: true, data: { ...interrupted, status: 'fetching' } })); await flush();
    expect(store.get(researchRunsAtom).find((run) => run.id === interrupted.id)?.status).toBe('fetching');
    expect(store.get(researchReportAtom)?.id).toBe(oldA.id);
    expect(container.querySelector('[data-testid="research-recovery"]') === null).toBe(true);
  } finally { await cleanup(); }
});

it('keeps a symbol-entry start pending and reports its failure for the entered security', async () => {
  const late = deferred<unknown>();
  const requested: unknown[] = [];
  const { store, container, cleanup } = await mountSelection({
    listRuns: async () => ({ ok: true, data: [] }),
    listReports: async () => ({ ok: true, data: [] }),
    start: (input: unknown) => { requested.push(input); return late.promise; },
  });
  try {
    await act(async () => store.set(activeSymbolAtom, null)); await flush();
    const input = container.querySelector<HTMLInputElement>('[data-testid="research-symbol-input"]')!;
    const { Simulate } = await import('react-dom/test-utils');
    await act(async () => {
      input.value = oldA.symbol;
      Simulate.change(input, { target: { value: oldA.symbol } } as unknown as Parameters<typeof Simulate.change>[1]);
    });
    await act(async () => (container.querySelector('[data-testid="research-symbol-submit"]') as HTMLButtonElement).click());
    await flush();
    expect(requested).toHaveLength(1);
    expect(store.get(activeSymbolAtom)).toBe(oldA.symbol);
    expect(container.textContent).toContain('Starting…');
    await act(async () => late.resolve({ ok: false, error: { code: 'FAILED', message: 'Start failed' } })); await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Deep Research is not available yet.');
  } finally { await cleanup(); }
});

it.each(['success', 'failure'] as const)('tracks a search-start for a security with existing history through %s', async (outcome) => {
  const late = deferred<unknown>();
  const requested: unknown[] = [];
  const newB = { ...onlyB, id: 'b-new', generatedAt: onlyB.generatedAt + 1000, summary: 'New B conclusion' };
  let finished = false;
  const run: ResearchRunSummary = { ...allRuns[0], id: 'new-b-run', status: 'fetching', reportId: undefined };
  const { store, container, cleanup } = await mountSelection({
    start: (input: unknown) => { requested.push(input); return late.promise; },
    listReports: async ({ symbol }: { symbol?: string }) => ({ ok: true, data: symbol === onlyB.symbol ? (finished ? [newB, onlyB] : [onlyB]) : [newA, oldA] }),
    getReport: async ({ reportId }: { reportId: string }) => ({ ok: true, data: [newB, ...allReports].find((item) => item.id === reportId) }),
    getRun: async () => { finished = true; return { ok: true, data: { ...run, status: 'completed', reportId: newB.id } }; },
  });
  try {
    const { Simulate } = await import('react-dom/test-utils');
    const input = container.querySelector<HTMLInputElement>('.folio-research-command-search input')!;
    await act(async () => Simulate.change(input, { target: { value: onlyB.symbol } } as unknown as Parameters<typeof Simulate.change>[1]));
    await act(async () => Simulate.keyDown(input, { key: 'Enter' })); await flush();
    expect(requested).toHaveLength(1);
    expect(store.get(activeSymbolAtom)).toBe(onlyB.symbol);
    expect(container.textContent).toContain('Starting…');
    if (outcome === 'failure') {
      await act(async () => late.resolve({ ok: false, error: { code: 'FAILED', message: 'Start failed' } })); await flush();
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('Deep Research is not available yet.');
    } else {
      await act(async () => late.resolve({ ok: true, data: run })); await flush();
      await act(async () => { await new Promise((r) => setTimeout(r, 950)); }); await flush();
      expect(store.get(researchReportAtom)?.id).toBe(newB.id);
    }
  } finally { await cleanup(); }
});

it('invalidates the displayed report synchronously when the symbol changes', async () => {
  const { store, cleanup } = await mountSelection();
  try {
    expect(store.get(researchReportAtom)?.id).toBe(newA.id);
    await act(async () => {
      store.set(activeSymbolAtom, onlyB.symbol);
      expect(store.get(researchReportAtom)).toBeNull();
    });
    await flush();
    expect(store.get(researchReportAtom)?.id).toBe(onlyB.id);
  } finally { await cleanup(); }
});

it('ignores an old symbol report response that arrives after the new report', async () => {
  const late = deferred<unknown>();
  const { store, container, cleanup } = await mountSelection({
    getReport: ({ reportId }: { reportId: string }) => reportId === newA.id ? late.promise : Promise.resolve({ ok: true, data: onlyB }),
  });
  try {
    await act(async () => store.set(activeSymbolAtom, onlyB.symbol)); await flush();
    await act(async () => late.resolve({ ok: true, data: newA })); await flush();
    expect(store.get(researchReportAtom)?.id).toBe(onlyB.id);
    expect(container.textContent).not.toContain(newA.summary);
  } finally { await cleanup(); }
});

it('Today opens the clicked old report with its original content and date', async () => {
  const { container, store, cleanup } = await mountSelection({}, true);
  try {
    const row = Array.from(container.querySelectorAll('li')).find((el) => el.textContent?.includes(oldA.summary));
    expect(row).toBeDefined();
    await act(async () => (row!.querySelector('button') as HTMLButtonElement).click()); await flush();
    expect(store.get(researchReportAtom)?.id).toBe(oldA.id);
    expect(container.textContent).toContain(oldA.summary);
    expect(container.textContent).toContain(new Date(oldA.generatedAt).toLocaleString());
    expect(container.textContent).not.toContain(newA.summary);
  } finally { await cleanup(); }
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
