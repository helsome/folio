import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Quote } from '@finagent/core';
import { i18nCurrentLocale, i18nSetCurrentLocale } from '@finagent/i18n';
import { installHappyDom } from '../../../test/setupHappyDom';
import { I18nextProvider, makeTestI18n } from '../../../test/i18nTest';
import { currencyForSymbol } from '../../../lib/money';
import { QuoteCard } from './QuoteCard';

let restoreDom: (() => void) | undefined;
let previousLocale: ReturnType<typeof i18nCurrentLocale>;

beforeAll(() => {
  previousLocale = i18nCurrentLocale();
  restoreDom = installHappyDom().restore;
  // @finagent/i18n formatters read a module-level active locale. Pin it so the
  // money output is deterministic regardless of test-run order in one process.
  i18nSetCurrentLocale('en-US');
});

afterAll(() => {
  i18nSetCurrentLocale(previousLocale);
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

const makeQuote = (overrides: Partial<Quote> = {}): Quote => ({
  ...quote,
  change: 1.5,
  changePercent: 0.83,
  volume: 52_000_000,
  ...overrides,
});

/** Render only the latest-price cell and return its trimmed text. */
async function renderPrice(value: Quote): Promise<string> {
  const { container, root } = await renderCard(value);
  const price = container.querySelector('[data-testid="quote-card-price"]');
  const text = (price?.textContent ?? '').trim();
  await act(async () => root.unmount());
  return text;
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

// What the router stamps on a quote when the keyless Yahoo provider answers
// (#353): US listings only, and delayed — so `delayed` is the provider's
// contract, not something the card gets to decide.
const yahooSource: NonNullable<Quote['source']> = {
  providerId: 'yahoo',
  providerName: 'Yahoo Finance',
  delayed: true,
};

describe('QuoteCard currency with provider provenance (Yahoo US)', () => {
  it('renders a Yahoo-sourced US quote in USD', async () => {
    const price = await renderPrice(
      makeQuote({ symbol: 'AAPL.US', lastPrice: 182.31, source: { ...yahooSource } })
    );
    expect(price).toMatch(/^\$182\.31$/);
  });

  it('takes the currency from the symbol, never from the provider', async () => {
    // A US-only provider does not license a `$` prefix: the router can still be
    // asked for another listing, and the card must render that instrument's
    // currency. Same regression as above, now carrying provenance.
    const price = await renderPrice(
      makeQuote({ symbol: '0700.HK', lastPrice: 350, source: { ...yahooSource } })
    );
    expect(price).toMatch(/^(HK\$|HKD)\s?350\.00$/);
  });

  it('leaves the provider provenance on the quote untouched', async () => {
    const delayedQuote = makeQuote({
      symbol: 'AAPL.US',
      lastPrice: 182.31,
      source: { ...yahooSource },
    });
    await renderPrice(delayedQuote);
    // Rendering decides the price cell only. Whether the data is delayed stays
    // the router's and the atoms' answer (#355 keys the UI wording off it), so
    // the card must neither drop, rewrite nor default it.
    expect(delayedQuote.source).toEqual({
      providerId: 'yahoo',
      providerName: 'Yahoo Finance',
      delayed: true,
    });
  });
});
