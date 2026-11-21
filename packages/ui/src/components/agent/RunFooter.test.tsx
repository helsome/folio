import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Run } from '@finagent/core';
import { installHappyDom } from '../../test/setupHappyDom';
import { withI18n } from '../../test/i18n';
import { FinagentClientProvider, fallbackClient, type FinagentClient } from '../../client';
import { RunFooter } from './AgentPanel';

let restoreDom: (() => void) | undefined;

beforeAll(() => {
  restoreDom = installHappyDom().restore;
});

afterAll(() => {
  restoreDom?.();
});

const baseRun: Run = {
  id: 'run-1',
  sessionId: 's1',
  status: 'cancelled',
  input: 'q',
  startedAt: 1_700_000_000_000,
  completedAt: 1_700_000_001_000,
};

function lastRun(overrides: Partial<Parameters<typeof RunFooter>[0]['lastRun']> & { status?: 'completed' | 'failed' | 'cancelled' }) {
  return {
    runId: 'run-1',
    sessionId: 's1',
    status: 'cancelled' as const,
    startedAt: 1_700_000_000_000,
    completedAt: 1_700_000_001_000,
    toolCount: 2,
    workspaceContext: undefined,
    ...overrides,
  };
}

function clientWithRuns(runs: Run[]): FinagentClient {
  return {
    ...fallbackClient,
    kernel: {
      ...fallbackClient.kernel,
      listRuns: async () => ({ ok: true as const, data: runs }),
    },
  };
}

async function renderFooter(container: HTMLElement, root: ReturnType<typeof createRoot>, props: { lastRun: ReturnType<typeof lastRun>; runs?: Run[] }) {
  const client = clientWithRuns(props.runs ?? []);
  await act(async () => {
    root.render(
      withI18n(
        <FinagentClientProvider client={client}>
          <RunFooter lastRun={props.lastRun} activeSessionId="s1" onOpenTrace={() => undefined} />
        </FinagentClientProvider>
      )
    );
  });
  // The footer reads the persisted run back asynchronously; flush the effect.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('RunFooter stop-reason display (#17)', () => {
  it('renders a plain cancelled run without claiming it completed', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    await renderFooter(container, root, {
      lastRun: lastRun({}),
      runs: [{ ...baseRun, stopReason: undefined }],
    });

    const footer = container.querySelector('[data-testid="run-footer"]');
    expect(footer?.textContent).toContain('Cancelled · 2 tools');
    expect(footer?.textContent).not.toContain('Completed');
    root.unmount();
  });

  it('surfaces a persisted budget stop from the run record', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    await renderFooter(container, root, {
      lastRun: lastRun({}),
      runs: [
        {
          ...baseRun,
          stopReason: 'budget_exhausted',
          stopDetail: { key: 'modelCalls', limit: 1, used: 1 },
        },
      ],
    });

    const footer = container.querySelector('[data-testid="run-footer"]');
    expect(footer?.textContent).toContain('Stopped early · budget exhausted · 2 tools · modelCalls 1/1');
    root.unmount();
  });

  it('surfaces a persisted retry storm with its evidence', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    await renderFooter(container, root, {
      lastRun: lastRun({}),
      runs: [
        {
          ...baseRun,
          stopReason: 'retry_storm',
          stopDetail: { signal: 'retry_storm', retriesInWindow: 3, windowMs: 60_000 },
        },
      ],
    });

    const footer = container.querySelector('[data-testid="run-footer"]');
    expect(footer?.textContent).toContain('Stopped early · too many retries · 2 tools · 3 retries');
    root.unmount();
  });

  it('prefers a guard stop carried by the event projection over the record', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    await renderFooter(container, root, {
      lastRun: lastRun({
        stopReason: 'loop_detected',
        stopDetail: { signal: 'repeated_tool_call', tool: 'get_quote', count: 2 },
      }),
      runs: [{ ...baseRun, stopReason: 'cancelled' }],
    });

    const footer = container.querySelector('[data-testid="run-footer"]');
    expect(footer?.textContent).toContain('Stopped early · loop detected · 2 tools · get_quote ×2');
    root.unmount();
  });

  it('keeps the completed footer for ordinary runs', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    await renderFooter(container, root, {
      lastRun: lastRun({ status: 'completed' }),
      runs: [{ ...baseRun, status: 'completed', stopReason: 'completed' }],
    });

    const footer = container.querySelector('[data-testid="run-footer"]');
    expect(footer?.textContent).toContain('Completed ·');
    expect(footer?.textContent).not.toContain('Cancelled');
    root.unmount();
  });
});
