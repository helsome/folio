import { Type } from '@sinclair/typebox';
import type { Quote } from '@finagent/core';
import type { FinanceCapability } from '@finagent/core';
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
      return {
        data: quote,
        provenance: {
          provider: 'longbridge',
          fetchedAt: (ctx?.now ?? Date.now)(),
          marketTime: quote.timestamp,
          stale: false,
        },
        summary: formatQuote(quote),
      };
    },
  });
}

function formatQuote(quote: Quote) {
  const changeIcon = quote.change >= 0 ? '[up]' : '[down]';
  const changeStr = quote.change >= 0
    ? `+${quote.change.toFixed(2)} (+${quote.changePercent.toFixed(2)}%)`
    : `${quote.change.toFixed(2)} (${quote.changePercent.toFixed(2)}%)`;
  const asOf = new Date(quote.timestamp * 1000).toLocaleString();

  return [
    `${changeIcon} ${quote.symbol}: $${quote.lastPrice.toFixed(2)}`,
    `Change: ${changeStr}`,
    `Volume: ${quote.volume.toLocaleString()}`,
    `High: $${quote.high.toFixed(2)} | Low: $${quote.low.toFixed(2)}`,
    `Open: $${quote.open.toFixed(2)} | Prev Close: $${quote.prevClose.toFixed(2)}`,
    `As of: ${asOf}`,
  ].join('\n');
}
