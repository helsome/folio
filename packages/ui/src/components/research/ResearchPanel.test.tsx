import { afterAll, beforeAll, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider, createStore } from 'jotai';
import type { ResearchRunSummary } from '@finagent/core';
import { installHappyDom } from '../../test/setupHappyDom';
import { TestI18n } from '../../test/testI18n';
import { FinagentClientProvider, fallbackClient } from '../../client';
import { activeSymbolAtom } from '../../atoms/workspaceAtoms';

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
