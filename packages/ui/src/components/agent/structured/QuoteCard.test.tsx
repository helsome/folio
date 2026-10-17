import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Quote } from '@finagent/core';
import { installHappyDom } from '../../../test/setupHappyDom';
import { I18nextProvider, makeTestI18n } from '../../../test/i18nTest';
import { QuoteCard } from './QuoteCard';

let restoreDom: (() => void) | undefined;

beforeAll(() => {
  restoreDom = installHappyDom().restore;
});

afterAll(() => {
  restoreDom?.();
});

/**
 * 2024-03-09T16:00:00Z. `Quote.timestamp` is epoch SECONDS (core index.ts and
 * the quote atoms both say so), so the card must scale it before handing it to
 * `Date`, exactly like SecurityHeader / ResearchMarketWorkspace do.
 */
const QUOTE_TIMESTAMP_SECONDS = 1_710_000_000;

const quote: Quote = {
  symbol: 'AAPL.US',
  lastPrice: 182.31,
  change: 1.02,
  changePercent: 0.56,
  volume: 12_345_678,
  timestamp: QUOTE_TIMESTAMP_SECONDS,
  high: 183.4,
  low: 180.1,
  open: 181.2,
  prevClose: 181.29,
};

/** The instant the epoch-seconds value denotes, rendered through the same formatter. */
const expectedUpdated = new Date(QUOTE_TIMESTAMP_SECONDS * 1000).toLocaleTimeString([], {
  hour: '2-digit',
  minute: '2-digit',
});

/** What `new Date(<epoch seconds>)` produces — the unit mix-up this file guards. */
const millisecondFallback = new Date(QUOTE_TIMESTAMP_SECONDS).toLocaleTimeString([], {
  hour: '2-digit',
  minute: '2-digit',
});

async function renderCard(value: Quote) {
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <I18nextProvider i18n={makeTestI18n('en-US')}>
        <QuoteCard quote={value} />
      </I18nextProvider>
    );
  });
  return { container, root };
}

describe('QuoteCard', () => {
  it('renders the quote update time from the epoch-seconds timestamp', async () => {
    const { container, root } = await renderCard(quote);

    const text = container.textContent ?? '';
    expect(text).toContain(expectedUpdated);
    expect(text).not.toContain(millisecondFallback);

    await act(async () => root.unmount());
  });

  it('keeps the remaining quote fields unaffected', async () => {
    const { container, root } = await renderCard(quote);

    const text = container.textContent ?? '';
    expect(text).toContain('182.31');
    expect(text).toContain('+1.02');
    expect(text).toContain('+0.56%');
    expect(text).toContain('12.35M');

    await act(async () => root.unmount());
  });
});
