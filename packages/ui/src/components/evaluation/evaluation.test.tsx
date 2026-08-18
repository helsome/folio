import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { fallbackClient, FinagentClientProvider } from '../../client';
import { I18nProvider } from '../../i18n/I18nProvider';
import { installHappyDom } from '../../test/setupHappyDom';
import { EvaluationCenter } from './EvaluationCenter';
import { EvaluationSettingsTab } from '../settings/EvaluationSettingsTab';

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
});
