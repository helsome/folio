import { Type } from '@sinclair/typebox';
import type { IntradayData } from '@finagent/core';
import type { FinanceCapability } from '@finagent/core';
import { defineCapability } from '../define.ts';
import { normalizeSymbol } from '../validate.ts';
import type { CapabilityFetchers } from '../fetchers.ts';
import { defaultCapabilityFetchers } from '../fetchers.ts';

export function createMarketIntradayCapability(
  fetchers: CapabilityFetchers = defaultCapabilityFetchers
): FinanceCapability<{ symbol: string }, IntradayData[]> {
  return defineCapability<{ symbol: string }, IntradayData[]>({
    id: 'market.intraday',
    name: 'Intraday',
    toolName: 'get_intraday',
    category: 'market',
    riskLevel: 'read',
    auth: 'public',
    description:
      'Get intraday tick-by-tick price and volume for a symbol during the current session. Use this to inspect how a stock is trading today, minute by minute.',
    inputSchema: Type.Object({
      symbol: Type.String({ description: 'Stock symbol, e.g. AAPL.US', examples: ['AAPL.US'] }),
    }),
    async execute(input, ctx) {
      const symbol = normalizeSymbol(input.symbol);
      const data = await fetchers.getIntraday(symbol);
      return {
        data,
        provenance: {
          provider: 'longbridge',
          fetchedAt: (ctx?.now ?? Date.now)(),
          marketTime: data[data.length - 1]?.timestamp,
          stale: false,
        },
        summary: formatIntraday(symbol, data),
      };
    },
  });
}

function formatIntraday(symbol: string, data: IntradayData[]) {
  const recent = data.slice(-10);
  return [
    `${symbol} Intraday`,
    '-----------------',
    ...recent.map((item) => {
      const time = new Date(item.timestamp * 1000).toLocaleTimeString();
      return `${time}: $${item.price.toFixed(2)} (V: ${item.volume})`;
    }),
  ].join('\n');
}
