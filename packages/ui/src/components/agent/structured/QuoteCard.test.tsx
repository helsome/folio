import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Quote } from '@finagent/core';
import { i18nSetCurrentLocale } from '@finagent/i18n';
import { installHappyDom } from '../../../test/setupHappyDom';
import { I18nextProvider, makeTestI18n } from '../../../test/i18nTest';
import { currencyForSymbol } from '../../../lib/money';
import { QuoteCard } from './QuoteCard';

let restoreDom: (() => void) | undefined;

beforeAll(() => {
  restoreDom = installHappyDom().restore;
  // @finagent/i18n formatters read a module-level active locale. Pin it so the
  // money output is deterministic regardless of test-run order in one process.
  i18nSetCurrentLocale('en-US');
});

afterAll(() => {
  restoreDom?.();
});

const makeQuote = (overrides: Partial<Quote> = {}): Quote => ({
  symbol: 'AAPL.US',
  lastPrice: 182.31,
  change: 1.5,
  changePercent: 0.83,
  volume: 52_000_000,
  // Repo convention: Quote.timestamp is epoch SECONDS (fmtTime handling is a
  // separate concern, tracked by issue #216 / PR #217 — not touched here).
  timestamp: 1_700_000_000,
  high: 183.0,
  low: 180.1,
  open: 180.5,
  prevClose: 180.81,
  ...overrides,
});

async function renderPrice(quote: Quote): Promise<string> {
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <I18nextProvider i18n={makeTestI18n('en-US')}>
        <QuoteCard quote={quote} />
      </I18nextProvider>
    );
  });
  const price = container.querySelector('[data-testid="quote-card-price"]');
  const text = (price?.textContent ?? '').trim();
  act(() => root.unmount());
  return text;
}

describe('currencyForSymbol', () => {
  // Pure mapping assertions — no ICU/locale involvement, so these hold however
  // a currency is later *formatted*.
  it('maps Hong Kong listings to HKD', () => {
    expect(currencyForSymbol('0700.HK')).toBe('HKD');
  });

  it('maps Shanghai and Shenzhen listings to CNY', () => {
    expect(currencyForSymbol('600519.SH')).toBe('CNY');
    expect(currencyForSymbol('000001.SZ')).toBe('CNY');
  });

  it('maps Singapore listings to SGD', () => {
    expect(currencyForSymbol('D05.SG')).toBe('SGD');
  });

  it('defaults US and unsupported suffixes to USD', () => {
    expect(currencyForSymbol('AAPL.US')).toBe('USD');
    expect(currencyForSymbol('SAP.DE')).toBe('USD'); // mirrors shared: no EUR map
    expect(currencyForSymbol('AAPL')).toBe('USD'); // no routed suffix
    expect(currencyForSymbol('')).toBe('USD');
  });

  it('is case-insensitive on the suffix', () => {
    expect(currencyForSymbol('0700.hk')).toBe('HKD');
    expect(currencyForSymbol('600519.sh')).toBe('CNY');
  });
});

describe('QuoteCard latest-price currency', () => {
  // Rendered assertions use tolerant patterns for the currency *symbol* because
  // the exact glyph is ICU-data dependent (e.g. HKD → "HK$350.00" vs "HKD 350.00").
  // The regression this guards — a bare "$" prefix on a non-USD quote — still
  // fails these patterns.
  it('renders a US price with the $ symbol (unchanged behavior)', async () => {
    expect(await renderPrice(makeQuote({ symbol: 'AAPL.US', lastPrice: 182.31 }))).toMatch(/^\$182\.31$/);
  });

  it('renders a Hong Kong price in HKD, not a bare $', async () => {
    // Regression guard: the card used to hardcode `$` → "$350.00" for HKD.
    expect(await renderPrice(makeQuote({ symbol: '0700.HK', lastPrice: 350 }))).toMatch(/^(HK\$|HKD)\s?350\.00$/);
  });

  it('renders a Shanghai (A-share) price in CNY', async () => {
    expect(await renderPrice(makeQuote({ symbol: '600519.SH', lastPrice: 12.5 }))).toMatch(/^(CN¥|CNY)\s?12\.50$/);
  });

  it('renders a Shenzhen price in CNY', async () => {
    expect(await renderPrice(makeQuote({ symbol: '000001.SZ', lastPrice: 12.5 }))).toMatch(/^(CN¥|CNY)\s?12\.50$/);
  });

  it('renders a Singapore price in SGD', async () => {
    expect(await renderPrice(makeQuote({ symbol: 'D05.SG', lastPrice: 350 }))).toMatch(/^SGD\s?350\.00$/);
  });

  it('renders an em dash when the price is missing/NaN', async () => {
    expect(await renderPrice(makeQuote({ lastPrice: NaN }))).toBe('—');
  });
});
