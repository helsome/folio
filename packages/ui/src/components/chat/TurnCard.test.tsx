import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Message } from '@finagent/core';
import { installHappyDom } from '../../test/setupHappyDom';
import { I18nextProvider, makeTestI18n } from '../../test/i18nTest';
import { TurnCard } from './TurnCard';

let restoreDom: (() => void) | undefined;

beforeAll(() => {
  restoreDom = installHappyDom().restore;
});

afterAll(() => {
  restoreDom?.();
});

const assistantMessage: Message = {
  id: 'assistant-1',
  role: 'assistant',
  content: 'The quote is current.',
  timestamp: 1_700_000_000_000,
  toolCalls: [
    {
      id: 'quote-1',
      toolName: 'get_quote',
      args: { symbol: 'AAPL.US' },
      startedAt: 1_700_000_000_000,
      completedAt: 1_700_000_000_500,
      status: 'success',
    },
  ],
};

describe('TurnCard', () => {
  it('renders persisted tool calls with the shared expandable activity timeline', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <I18nextProvider i18n={makeTestI18n('en-US')}>
          <TurnCard message={assistantMessage} />
        </I18nextProvider>
      );
    });

    expect(container.querySelector('[data-testid="tool-activity-toggle"]')).not.toBeNull();
    expect(container.textContent).toContain('Analyzed 1 source');
    expect(container.textContent).not.toContain('get_quote');
  });
});
