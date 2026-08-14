import { Type } from '@sinclair/typebox';
import type { CalcIndex } from '@finagent/core';
import type { FinanceCapability } from '@finagent/core';
import { defineCapability } from '../define.ts';
import { normalizeSymbol } from '../validate.ts';
import type { CapabilityFetchers } from '../fetchers.ts';
import { defaultCapabilityFetchers } from '../fetchers.ts';

export function createCompanyValuationCapability(
  fetchers: CapabilityFetchers = defaultCapabilityFetchers
): FinanceCapability<{ symbol: string }, CalcIndex> {
  return defineCapability<{ symbol: string }, CalcIndex>({
    id: 'company.valuation',
    name: 'Valuation',
    toolName: 'get_valuation',
    category: 'company',
    riskLevel: 'read',
    auth: 'public',
    description:
      'Get calculated valuation indexes for a symbol: PE, PB, dividend yield, market value, turnover and YTD change. Use this to assess whether a stock looks cheap or expensive relative to fundamentals.',
    inputSchema: Type.Object({
      symbol: Type.String({ description: 'Stock symbol, e.g. AAPL.US', examples: ['AAPL.US'] }),
    }),
    async execute(input, ctx) {
      const symbol = normalizeSymbol(input.symbol);
      const index = await fetchers.getCalcIndex(symbol);
      return {
        data: index,
        provenance: { provider: 'longbridge', fetchedAt: (ctx?.now ?? Date.now)(), stale: false },
        summary: formatCalcIndex(index),
      };
    },
  });
}

function formatCalcIndex(index: CalcIndex) {
  const lines = [
    'Valuation',
    '-----------------',
    `Symbol: ${index.symbol}`,
  ];
  if (index.pe !== undefined) lines.push(`PE: ${index.pe}`);
  if (index.pb !== undefined) lines.push(`PB: ${index.pb}`);
  if (index.dpsRate !== undefined) lines.push(`Dividend yield: ${index.dpsRate}%`);
  if (index.totalMarketValue !== undefined) lines.push(`Market value: ${index.totalMarketValue}`);
  if (index.turnoverRate !== undefined) lines.push(`Turnover: ${index.turnoverRate}%`);
  if (index.ytdChangeRate !== undefined) lines.push(`YTD change: ${index.ytdChangeRate}%`);
  if (index.volumeRatio !== undefined) lines.push(`Volume ratio: ${index.volumeRatio}`);
  if (index.amplitude !== undefined) lines.push(`Amplitude: ${index.amplitude}%`);
  return lines.join('\n');
}
