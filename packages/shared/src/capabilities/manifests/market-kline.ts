import { Type } from '@sinclair/typebox';
import type { Kline } from '@finagent/core';
import type { FinanceCapability } from '@finagent/core';
import { defineCapability } from '../define.ts';
import { normalizeSymbol } from '../validate.ts';
import type { CapabilityFetchers } from '../fetchers.ts';
import { defaultCapabilityFetchers } from '../fetchers.ts';

const KlinePeriod = Type.Union([
  Type.Literal('1m'),
  Type.Literal('5m'),
  Type.Literal('15m'),
  Type.Literal('1h'),
  Type.Literal('1d'),
  Type.Literal('1w'),
]);

export type KlineInput = {
  symbol: string;
  period?: '1m' | '5m' | '15m' | '1h' | '1d' | '1w';
  limit?: number;
};

export function createMarketKlineCapability(
  fetchers: CapabilityFetchers = defaultCapabilityFetchers
): FinanceCapability<KlineInput, Kline[]> {
  return defineCapability<KlineInput, Kline[]>({
    id: 'market.kline',
    name: 'K-Line',
    toolName: 'get_kline',
    category: 'market',
    riskLevel: 'read',
    auth: 'public',
    description:
      'Get historical K-line (candlestick) bars for a symbol over a chosen period (1m/5m/15m/1h/1d/1w). Use this to analyze price trends, support/resistance, or recent volatility over time.',
    inputSchema: Type.Object({
      symbol: Type.String({ description: 'Stock symbol, e.g. AAPL.US', examples: ['AAPL.US'] }),
      period: Type.Optional(KlinePeriod),
      limit: Type.Optional(Type.Number({ default: 100, minimum: 1, maximum: 1000 })),
    }),
    async execute(input, ctx) {
      const symbol = normalizeSymbol(input.symbol);
      const period = input.period ?? '1d';
      const limit = input.limit ?? 100;
      const klines = await fetchers.getKline({ symbol, period, limit });
      return {
        data: klines,
        provenance: {
          provider: 'longbridge',
          fetchedAt: (ctx?.now ?? Date.now)(),
          marketTime: klines[klines.length - 1]?.timestamp,
          stale: false,
        },
        summary: formatKline(symbol, period, klines),
      };
    },
  });
}

function formatKline(symbol: string, period: string, klines: Kline[]) {
  const recent = klines.slice(-5);
  return [
    `${symbol} K-Line (${period})`,
    '-----------------',
    ...recent.map((kline) => {
      const date = new Date(kline.timestamp * 1000).toLocaleDateString();
      return `${date}: O$${kline.open.toFixed(2)} H$${kline.high.toFixed(2)} L$${kline.low.toFixed(2)} C$${kline.close.toFixed(2)} V${kline.volume}`;
    }),
  ].join('\n');
}
