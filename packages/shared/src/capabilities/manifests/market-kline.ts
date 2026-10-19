import { Type } from '@sinclair/typebox';
import type { FinancialFact, Kline } from '@finagent/core';
import type { FinanceCapability } from '@finagent/core';
import { describeFact, klineToFacts, marketCurrencyOf, readInstrumentId } from '@finagent/core';
import { defineCapability } from '../define.ts';
import { normalizeSymbol } from '../validate.ts';
import type { CapabilityFetchers } from '../fetchers.ts';
import { defaultCapabilityFetchers } from '../fetchers.ts';
import { resolveCanonicalInstrument } from '../instruments.ts';

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
    async execute(input, ctx, reportProvider) {
      const symbol = normalizeSymbol(input.symbol);
      const period = input.period ?? '1d';
      const limit = input.limit ?? 100;
      const options = { symbol, period, limit };
      const fetched = fetchers.getKlineResult
        ? await fetchers.getKlineResult(options, ctx?.signal)
        : undefined;
      const klines = fetched?.data ?? await fetchers.getKline(options);
      if (fetched) reportProvider?.(fetched.provenance);

      const prov = fetched?.provenance;
      const provider = prov?.providerId ?? 'longbridge';
      const providerName = prov?.providerName ?? 'Longbridge';
      const canonical = resolveCanonicalInstrument(symbol, prov?.providerId);
      const instrumentId =
        readInstrumentId(klines) ?? prov?.instrumentId ?? canonical?.instrumentId;
      const currency = marketCurrencyOf(symbol) ?? canonical?.currency;

      // Kline.timestamp is epoch SECONDS (see formatKline below); every other
      // producer writes provenance.marketTime in epoch MS (market.quote does
      // `timestamp * 1000`, longbridge's marketTimeMsFrom() the same).
      const latest = klines[klines.length - 1];
      const fetchedAt = prov?.fetchedAt ?? (ctx?.now ?? Date.now)();
      const timing = period === '1d' || period === '1w' ? 'eod' : 'historical';
      const stale = prov?.stale ?? false;
      const facts = klines.map((kline) =>
        klineToFacts(kline, {
          instrumentId,
          provider,
          currency,
          timing,
          adjustment: 'unknown', // CLI does not report adjustment — never assume raw
          retrievedAt: Math.floor(fetchedAt / 1000),
        })
      );
      return {
        data: klines,
        facts: facts.flat(),
        provenance: {
          provider,
          providerName,
          ...(instrumentId ? { instrumentId } : {}),
          fetchedAt,
          marketTime: latest === undefined ? undefined : latest.timestamp * 1000,
          ...(prov?.delayed !== undefined ? { delayed: prov.delayed } : {}),
          stale,
        },
        summary: formatKline(symbol, period, klines, facts),
      };
    },
  });
}

function formatKline(
  symbol: string,
  period: string,
  klines: Kline[],
  facts: FinancialFact[][]
) {
  const recent = klines.slice(-5);
  const latestClose = facts[facts.length - 1]?.find((fact) => fact.metric === 'close');
  return [
    `${symbol} K-Line (${period})`,
    '-----------------',
    ...recent.map((kline) => {
      const date = new Date(kline.timestamp * 1000).toLocaleDateString();
      return `${date}: O$${kline.open.toFixed(2)} H$${kline.high.toFixed(2)} L$${kline.low.toFixed(2)} C$${kline.close.toFixed(2)} V${kline.volume}`;
    }),
    latestClose ? `Semantics: ${describeFact(latestClose)}` : '',
  ].join('\n');
}
