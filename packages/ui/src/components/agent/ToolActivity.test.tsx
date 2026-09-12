import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { ToolCall } from '@finagent/core';
import { installHappyDom } from '../../test/setupHappyDom';
import { I18nextProvider, makeTestI18n } from '../../test/i18nTest';
import { ToolActivity } from './ToolActivity';

let restoreDom: (() => void) | undefined;

beforeAll(() => {
  restoreDom = installHappyDom().restore;
});

afterAll(() => {
  restoreDom?.();
});

const calls: ToolCall[] = [
  {
    id: 'quote-1',
    toolName: 'get_quote',
    args: { symbol: 'AAPL.US' },
    startedAt: 1_700_000_000_000,
    completedAt: 1_700_000_001_250,
    status: 'success',
  },
  {
    id: 'news-1',
    toolName: 'get_news',
    args: {},
    startedAt: 1_700_000_002_000,
    completedAt: 1_700_000_002_050,
    status: 'error',
    error: { code: 'NETWORK_UNAVAILABLE', message: 'News provider is unavailable' },
  },
];

describe('ToolActivity', () => {
  it('shows safe duration and error details for restored completed calls', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <I18nextProvider i18n={makeTestI18n('en-US')}>
          <ToolActivity toolCalls={calls} />
        </I18nextProvider>
      );
    });

    const toggle = container.querySelector<HTMLButtonElement>('[data-testid="tool-activity-toggle"]');
    expect(toggle).not.toBeNull();
    act(() => toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    const quote = container.querySelectorAll('[data-testid="tool-activity-call"]')[0]?.textContent ?? '';
    expect(quote).toContain('Fetch quote');
    expect(quote).toContain('AAPL.US');
    expect(quote).toContain('1.3s');

    const news = container.querySelectorAll('[data-testid="tool-activity-call"]')[1]?.textContent ?? '';
    expect(news).toContain('Check news');
    expect(news).toContain('0.1s');
    expect(news).toContain('Tool failed');
    expect(news).not.toContain('News provider is unavailable');
    expect(news).not.toContain('get_news');
    expect(container.innerHTML).not.toContain('news-1');
  });

  it('hides untrusted error text and malformed symbol arguments', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const untrustedCall: ToolCall = {
      id: 'unsafe-1',
      toolName: 'get_quote',
      args: { symbol: 'Bearer sk-test-secret' },
      startedAt: 1_700_000_000_000,
      completedAt: 1_700_000_000_100,
      status: 'error',
      error: { code: 'UPSTREAM_ERROR', message: 'request failed for Authorization: Bearer sk-test-secret' },
    };

    await act(async () => {
      root.render(
        <I18nextProvider i18n={makeTestI18n('en-US')}>
          <ToolActivity toolCalls={[untrustedCall]} />
        </I18nextProvider>
      );
    });

    const toggle = container.querySelector<HTMLButtonElement>('[data-testid="tool-activity-toggle"]');
    act(() => toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    const text = container.textContent ?? '';
    expect(text).toContain('Tool failed');
    expect(text).not.toContain('sk-test-secret');
    expect(text).not.toContain('Bearer');
    expect(text).not.toContain('get_quote');
    expect(container.innerHTML).not.toContain('unsafe-1');
  });
});
