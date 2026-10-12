import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { AppPreferencesSnapshot } from '@finagent/core';
import { fallbackClient, FinagentClientProvider, type EvaluationChannel, type FinagentClient } from '../../client';
import { I18nProvider } from '../../i18n/I18nProvider';
import { installHappyDom } from '../../test/setupHappyDom';
import { EvaluationCenter } from './EvaluationCenter';
import { EvaluationSettingsTab } from '../settings/EvaluationSettingsTab';
import { TooltipProvider } from '../ui/tooltip';

let restoreDom: (() => void) | undefined;

beforeAll(() => {
  restoreDom = installHappyDom().restore;
});

afterAll(() => {
  restoreDom?.();
});

async function render(element: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <FinagentClientProvider client={fallbackClient}>
        <I18nProvider>{element}</I18nProvider>
      </FinagentClientProvider>
    );
  });
  return { container, root };
}

describe('EvaluationCenter', () => {
  it('renders the shell with tab navigation when the channel is unwired', async () => {
    const { container, root } = await render(<EvaluationCenter />);
    expect(container.textContent).toContain('Evaluation Center');
    for (const label of ['Overview', 'Experiments', 'Model Comparison', 'Failure Modes']) {
      expect(container.textContent).toContain(label);
    }
    // The fallback client answers CLIENT_UNAVAILABLE → the error banner shows.
    await act(async () => {});
    expect(container.textContent).toContain('is unavailable in this environment');
    root.unmount();
  });

  it('switches internal tabs on click', async () => {
    const { container, root } = await render(<EvaluationCenter />);
    await act(async () => {});
    const buttons = Array.from(container.querySelectorAll('button'));
    const modelTab = buttons.find((button) => button.textContent === 'Model Comparison');
    expect(modelTab).toBeDefined();
    await act(async () => {
      modelTab?.click();
    });
    // With the unwired fallback channel the error banner remains in view,
    // but the tab switch must not crash.
    expect(container.textContent).toContain('is unavailable in this environment');
    root.unmount();
  });
});

describe('EvaluationSettingsTab', () => {
  it('degrades to the unwired notice when the channel is unavailable', async () => {
    const { container, root } = await render(<EvaluationSettingsTab />);
    await act(async () => {});
    expect(container.textContent).toContain('Evaluation settings aren\u0027t available yet');
    root.unmount();
  });

  it('renders the Langfuse connection card when evaluation settings load', async () => {
    const client: FinagentClient = {
      ...fallbackClient,
      evaluation: {
        ...fallbackClient.evaluation,
        getSettings: async () => ({
          ok: true,
          data: {
            settings: {
              tracingEnabled: false,
              langsmithProject: 'folio-agent',
              langsmithEndpoint: '',
              langfuseTracingEnabled: true,
              langfuseHost: 'https://cloud.langfuse.com',
              langfuseConfigured: true,
              privacyLevel: 'standard',
              onlineEvaluationEnabled: false,
              apiKeyConfigured: false,
              updatedAt: 1,
            },
            connection: { connected: false, configured: false },
            langfuse: { connected: true, configured: true, endpoint: 'https://cloud.langfuse.com' },
          },
        }),
      } as EvaluationChannel,
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <FinagentClientProvider client={client}>
          <I18nProvider>
            <TooltipProvider>
              <EvaluationSettingsTab />
            </TooltipProvider>
          </I18nProvider>
        </FinagentClientProvider>
      );
    });
    await act(async () => {});
    expect(container.textContent).toContain('Langfuse Connection');
    expect(container.textContent).toContain('Langfuse tracing');
    expect(container.querySelector('[data-testid="langfuse-settings"]')).not.toBeNull();
    root.unmount();
  });

  it('renders the Langfuse empty state when keys are not configured', async () => {
    const client: FinagentClient = {
      ...fallbackClient,
      evaluation: {
        ...fallbackClient.evaluation,
        getSettings: async () => ({
          ok: true,
          data: {
            settings: {
              tracingEnabled: false,
              langsmithProject: 'folio-agent',
              langsmithEndpoint: '',
              langfuseTracingEnabled: false,
              langfuseHost: '',
              langfuseConfigured: false,
              privacyLevel: 'standard',
              onlineEvaluationEnabled: false,
              apiKeyConfigured: false,
              updatedAt: 1,
            },
            connection: { connected: false, configured: false },
            langfuse: { connected: false, configured: false },
          },
        }),
      } as EvaluationChannel,
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <FinagentClientProvider client={client}>
          <I18nProvider>
            <TooltipProvider>
              <EvaluationSettingsTab />
            </TooltipProvider>
          </I18nProvider>
        </FinagentClientProvider>
      );
    });
    await act(async () => {});
    expect(container.textContent).toContain('Langfuse Connection');
    expect(container.textContent).toContain('Add Langfuse public and secret keys');
    root.unmount();
  });
});

/**
 * Settings → Evaluation showed `result.error.message` verbatim, i.e. the
 * English text carried in the IPC envelope, even though `@finagent/i18n`
 * already registers localised copy for the same *stable* `ApiError.code`
 * (error-messages.ts `ERROR_CODE_TO_KEY` → the `errors.*` namespace). A zh-CN
 * user therefore got English on every failure of this page.
 *
 * The resolution order these cases pin: registered code → localised copy;
 * unregistered code → the raw sanitized message is kept (never dropped).
 */
function zhClientFailingSettings(code: string, message: string): FinagentClient {
  const snapshot = {
    preference: 'zh-CN',
    systemLocale: 'zh-CN',
    effectiveLocale: 'zh-CN',
  } as AppPreferencesSnapshot;
  return {
    ...fallbackClient,
    prefs: {
      get: async () => ({ ok: true, data: snapshot }),
      update: async () => ({ ok: true, data: snapshot }),
    },
    evaluation: {
      ...fallbackClient.evaluation,
      getSettings: async () => ({ ok: false, error: { code, message } }),
    } as EvaluationChannel,
  };
}

async function renderFailingSettings(code: string, message: string) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <FinagentClientProvider client={zhClientFailingSettings(code, message)}>
        <I18nProvider>
          <TooltipProvider>
            <EvaluationSettingsTab />
          </TooltipProvider>
        </I18nProvider>
      </FinagentClientProvider>
    );
  });
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  return { container, root };
}

describe('EvaluationSettingsTab error copy', () => {
  it('prefers the errors.* copy registered for the ApiError code over the raw IPC message', async () => {
    const { container, root } = await renderFailingSettings(
      'STORAGE_WRITE_FAILED',
      'STORAGE_WRITE_FAILED: connection is locked',
    );
    const text = container.textContent ?? '';
    // errors.storageWriteFailed (zh-CN) — the registered localised copy.
    expect(text).toContain('无法保存更改');
    expect(text).not.toContain('connection is locked');
    root.unmount();
  });

  it('keeps the raw message when the code has no registered copy', async () => {
    const { container, root } = await renderFailingSettings(
      'MASSIVE_PLAN_DENIED',
      'your plan does not include this dataset',
    );
    expect(container.textContent ?? '').toContain('your plan does not include this dataset');
    root.unmount();
  });
});
