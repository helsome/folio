import { Type } from '@sinclair/typebox';
import type { FinancialFact, Quote } from '@finagent/core';
import type { FinanceCapability } from '@finagent/core';
import { describeFact, marketCurrencyOf, quoteToFacts } from '@finagent/core';
import { defineCapability } from '../define.ts';
import { normalizeSymbol } from '../validate.ts';
import type { CapabilityFetchers } from '../fetchers.ts';
import { defaultCapabilityFetchers } from '../fetchers.ts';

export function createMarketQuoteCapability(
  fetchers: CapabilityFetchers = defaultCapabilityFetchers
): FinanceCapability<{ symbol: string }, Quote> {
  return defineCapability<{ symbol: string }, Quote>({
    id: 'market.quote',
    name: 'Quote',
    toolName: 'get_quote',
    category: 'market',
    riskLevel: 'read',
    auth: 'public',
    description:
      'Get a real-time quote for a single symbol: last price, change, volume, and the day high/low/open/prev-close. Use this whenever the user asks for the current price or the day move of a specific stock.',
    inputSchema: Type.Object({
      symbol: Type.String({
        description: 'Stock symbol, e.g. AAPL.US, 0700.HK, 600519.SH',
        examples: ['AAPL.US', '0700.HK'],
      }),
    }),
    async execute(input, ctx) {
      const symbol = normalizeSymbol(input.symbol);
      const quote = await fetchers.getQuote(symbol);
      const fetchedAt = (ctx?.now ?? Date.now)();
      // Native currency is derived from the market code (structured, not free
      // text). Quotes are real-time by contract; the `delayed`/`eod` variants
      // are produced by callers that know a delay applies.
      const facts = quoteToFacts(quote, {
        provider: 'longbridge',
        currency: marketCurrencyOf(symbol),
        timing: 'live',
        retrievedAt: Math.floor(fetchedAt / 1000),
      });
      return {
        data: quote,
        facts,
        provenance: {
          provider: 'longbridge',
          fetchedAt,
          marketTime: quote.timestamp,
          stale: false,
        },
        summary: formatQuote(quote, facts),
      };
    },
  });
}

function formatQuote(quote: Quote, facts: FinancialFact[]) {
  const symbol = currencySymbol(facts.find((fact) => fact.metric === 'lastPrice')?.currency);
  const changeIcon = quote.change >= 0 ? '[up]' : '[down]';
  const changeStr = quote.change >= 0
    ? `+${quote.change.toFixed(2)} (+${quote.changePercent.toFixed(2)}%)`
    : `${quote.change.toFixed(2)} (${quote.changePercent.toFixed(2)}%)`;

  const lastPrice = facts.find((fact) => fact.metric === 'lastPrice');

  return [
    `${changeIcon} ${quote.symbol}: ${symbol}${quote.lastPrice.toFixed(2)}`,
    `Change: ${changeStr}`,
    `Volume: ${quote.volume.toLocaleString()}`,
    `High: ${symbol}${quote.high.toFixed(2)} | Low: ${symbol}${quote.low.toFixed(2)}`,
    `Open: ${symbol}${quote.open.toFixed(2)} | Prev Close: ${symbol}${quote.prevClose.toFixed(2)}`,
    lastPrice ? `Semantics: ${describeFact(lastPrice)}` : '',
  ].join('\n');
}

/** Minimal structured currency-symbol lookup (falls back to the ISO code). */
function currencySymbol(currency: string | undefined): string {
  switch (currency) {
    case 'USD':
      return '$';
    case 'HKD':
      return 'HK$';
    case 'CNY':
      return '¥';
    case 'SGD':
      return 'S$';
    default:
      return currency ? `${currency} ` : '';
  }
}
