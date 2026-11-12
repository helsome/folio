import { afterAll, beforeAll, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { ApiResult, EvaluationExperiment } from '@finagent/core';
import { fallbackClient, FinagentClientProvider, type EvaluationChannel, type EvaluationExperimentDetail, type FinagentClient } from '../../client';
import { installHappyDom } from '../../test/setupHappyDom';
import { withI18n } from '../../test/i18n';
import { TestI18n } from '../../test/testI18n';
import { EvaluationCenter } from './EvaluationCenter';
import { CaseDetail } from './CaseDetail';

let restoreDom: () => void;
beforeAll(() => { restoreDom = installHappyDom().restore; });
afterAll(() => restoreDom());

function experiment(id = 'experiment-1'): EvaluationExperiment {
  return {
    id, name: id, datasetId: 'fixture', datasetVersion: '1', status: 'completed', mode: 'fixture',
    config: { mode: 'fixture' }, metadata: { timestamp: 1 }, startedAt: 1, runIds: ['run-1'], resultIds: [],
    summary: {
      passRate: 1, compositeScore: 1, metricAggregates: [], failureModes: [], totalRuns: 1, completedRuns: 1,
      validity: 'valid', execution: { requested: 1, started: 1, evaluated: 1, infraFailed: 0, skipped: 0 }, validityReasons: [],
    },
  };
}

function detail(id = 'experiment-1'): EvaluationExperimentDetail {
  return {
    experiment: experiment(id), results: [],
    runs: [{ id: 'run-1', experimentId: id, caseId: 'case-1', datasetId: 'fixture', status: 'completed',
      startedAt: 1, answer: 'The recorded case answer.', toolCalls: [], failureModes: [] }],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find((entry) => entry.textContent?.trim() === text);
  if (!found) throw new Error('Missing button: ' + text);
  return found;
}

async function mountCenter(
  getExperiment: EvaluationChannel['getExperiment'],
  experiments = [experiment()],
  locale: 'en-US' | 'zh-CN' = 'en-US'
) {
  const client: FinagentClient = {
    ...fallbackClient,
    evaluation: {
      ...fallbackClient.evaluation!, getExperiment,
      listExperiments: async () => ({ ok: true, data: experiments }),
      listBaselines: async () => ({ ok: true, data: [] }),
      getCase: async () => ({ ok: true, data: undefined }),
    },
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(withI18n(<FinagentClientProvider client={client}><EvaluationCenter /></FinagentClientProvider>, locale)); });
  return {
    container,
    async openSummary() {
      const summary = container.querySelector<HTMLButtonElement>('[data-testid="overview-tab"] button');
      if (!summary) throw new Error('Summary button is missing');
      await act(async () => summary.click());
    },
    async close() { await act(async () => root.unmount()); container.remove(); },
  };
}

for (const locale of ['en-US', 'zh-CN'] as const) {
  for (const missing of [false, true]) {
    it('settles a real center/detail ' + (missing ? 'missing record' : 'API failure') + ' in ' + locale, async () => {
      const view = await mountCenter(async () => missing
        ? { ok: true, data: undefined }
        : { ok: false, error: { code: 'STORAGE_READ_FAILED', message: 'Controlled detail read failure' } }, undefined, locale);
      try {
        await view.openSummary();
        expect(Boolean(view.container.querySelector('svg.animate-spin'))).toBe(false);
        expect(view.container.textContent).toContain(missing
          ? locale === 'en-US' ? 'Experiment experiment-1 could not be loaded.' : '实验 experiment-1 无法加载。'
          : 'Controlled detail read failure');
        expect(Boolean(view.container.querySelector('[role="alert"]'))).toBe(true);
      } finally { await view.close(); }
    });
  }
}

it('retries the real parent request and opens the real case detail after recovery', async () => {
  let calls = 0;
  const view = await mountCenter(async () => ++calls === 1
    ? { ok: false, error: { code: 'STORAGE_READ_FAILED', message: 'Temporary detail failure' } }
    : { ok: true, data: detail() });
  try {
    await view.openSummary();
    expect(calls).toBe(1);
    await act(async () => button(view.container, 'Retry').click());
    expect(calls).toBe(2);
    expect(Boolean(view.container.querySelector('[data-testid="runs-table"]'))).toBe(true);
    expect(Boolean(view.container.querySelector('svg.animate-spin'))).toBe(false);
    await act(async () => button(view.container, 'case-1').click());
    expect(Boolean(view.container.querySelector('[data-testid="case-detail"]'))).toBe(true);
    expect(view.container.textContent).toContain('The recorded case answer.');
    expect(calls).toBe(2); // Case navigation reuses the successful parent cache.
  } finally { await view.close(); }
});

it('keeps the current experiment error and does not cache an abandoned response', async () => {
  const old = deferred<ApiResult<EvaluationExperimentDetail | undefined>>();
  let firstCalls = 0;
  const view = await mountCenter(async (id) => id === 'first'
    ? ++firstCalls === 1 ? old.promise : { ok: false, error: { code: 'READ', message: 'Fresh first failure' } }
    : { ok: false, error: { code: 'READ', message: 'Current second failure' } }, [experiment('first'), experiment('second')]);
  try {
    await view.openSummary();
    expect(Boolean(view.container.querySelector('svg.animate-spin'))).toBe(true);
    await act(async () => button(view.container, 'Back').click());
    await act(async () => button(view.container, 'Experiments').click());
    const row = Array.from(view.container.querySelectorAll('tbody tr')).find((entry) => entry.textContent?.includes('second'));
    await act(async () => row?.querySelector('button')?.click());
    expect(view.container.textContent).toContain('Current second failure');
    await act(async () => old.resolve({ ok: true, data: detail('first') }));
    expect(view.container.textContent).toContain('Current second failure');
    expect(Boolean(view.container.querySelector('[data-testid="runs-table"]'))).toBe(false);
    await act(async () => button(view.container, 'Back').click());
    const firstRow = Array.from(view.container.querySelectorAll('tbody tr')).find((entry) => entry.textContent?.includes('first'));
    await act(async () => firstRow?.querySelector('button')?.click());
    expect(firstCalls).toBe(2);
    expect(view.container.textContent).toContain('Fresh first failure');
  } finally {
    await view.close();
    await act(async () => old.resolve({ ok: true, data: detail('first') }));
  }
});

it('does not let an abandoned background prefetch replace the current detail error', async () => {
  const old = deferred<ApiResult<EvaluationExperimentDetail | undefined>>();
  let calls = 0;
  const view = await mountCenter(async () => ++calls === 1 ? old.promise
    : { ok: false, error: { code: 'READ', message: 'Current selected failure' } });
  try {
    await act(async () => button(view.container, 'Failure Modes').click());
    expect(calls).toBe(1);
    await act(async () => button(view.container, 'Experiments').click());
    await act(async () => view.container.querySelector<HTMLButtonElement>('tbody tr button')?.click());
    expect(view.container.textContent).toContain('Current selected failure');
    await act(async () => old.resolve({ ok: true, data: detail() }));
    expect(view.container.textContent).toContain('Current selected failure');
    expect(Boolean(view.container.querySelector('[data-testid="runs-table"]'))).toBe(false);
  } finally {
    await view.close();
    await act(async () => old.resolve({ ok: true, data: detail() }));
  }
});

it('settles and retries a real CaseDetail with a controlled parent loader', async () => {
  let calls = 0;
  function Parent() {
    const [data, setData] = React.useState<EvaluationExperimentDetail | null>(null);
    const load = React.useCallback(async () => {
      if (++calls === 1) return null;
      const loaded = detail();
      setData(loaded);
      return loaded;
    }, []);
    return <CaseDetail caseRef={{ experimentId: 'experiment-1', caseId: 'case-1' }} detail={data}
      onLoadDetail={load} onBack={() => {}} />;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<TestI18n><Parent /></TestI18n>));
    expect(Boolean(container.querySelector('svg.animate-spin'))).toBe(false);
    expect(container.textContent).toContain('Case case-1 could not be loaded.');
    await act(async () => button(container, 'Retry').click());
    expect(calls).toBe(2);
    expect(container.textContent).toContain('The recorded case answer.');
  } finally { await act(async () => root.unmount()); container.remove(); }
});

it('does not let an old CaseDetail completion replace the new case error', async () => {
  const old = deferred<EvaluationExperimentDetail | null>();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<TestI18n><CaseDetail caseRef={{ experimentId: 'first', caseId: 'old-case' }}
      detail={null} onLoadDetail={() => old.promise} onBack={() => {}} /></TestI18n>));
    await act(async () => root.render(<TestI18n><CaseDetail caseRef={{ experimentId: 'second', caseId: 'new-case' }}
      detail={null} onLoadDetail={async () => null} onBack={() => {}} /></TestI18n>));
    expect(container.textContent).toContain('Case new-case could not be loaded.');
    await act(async () => old.resolve(detail('first')));
    expect(container.textContent).toContain('Case new-case could not be loaded.');
    expect(container.textContent).not.toContain('old-case');
  } finally { await act(async () => root.unmount()); container.remove(); }
});

it('invalidates the CaseDetail parent load signal on unmount', async () => {
  const pending = deferred<EvaluationExperimentDetail | null>();
  let signal: AbortSignal | undefined;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<TestI18n><CaseDetail caseRef={{ experimentId: 'first', caseId: 'case-1' }}
    detail={null} onLoadDetail={(value?: AbortSignal) => { signal = value; return pending.promise; }} onBack={() => {}} /></TestI18n>));
  await act(async () => root.unmount());
  expect(signal?.aborted).toBe(true);
  await act(async () => pending.resolve(null));
  expect(container.textContent).toBe('');
  container.remove();
});
