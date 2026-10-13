import { Type } from '@sinclair/typebox';
import {
  DEFAULT_INSTRUMENT_CATALOG,
  InstrumentResolver,
  readInstrumentId,
} from '@finagent/core';
import type {
  FinanceCapability,
  Quote,
} from '@finagent/core';
import { defineCapability } from '../define.ts';
import { normalizeSymbol } from '../validate.ts';
import type { CapabilityFetchers } from '../fetchers.ts';
import { defaultCapabilityFetchers } from '../fetchers.ts';
import { reconcileQuoteResults } from '../../providers/quote-reconciliation.ts';

const DEFAULT_INSTRUMENT_RESOLVER = new InstrumentResolver(DEFAULT_INSTRUMENT_CATALOG);

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
    async execute(input, ctx, reportProvider) {
      const symbol = normalizeSymbol(input.symbol);
      const candidates = await fetchers.getQuoteCandidates?.(symbol, ctx?.signal);
      const reconciled = candidates ? reconcileQuoteResults(candidates) : undefined;
      const fetched = !reconciled?.selected && fetchers.getQuoteResult
        ? await fetchers.getQuoteResult(symbol, ctx?.signal)
        : undefined;
      const quote = reconciled?.selected?.data ?? fetched?.data ?? await fetchers.getQuote(symbol);
      if (reconciled?.selected) reportProvider?.(reconciled.selected.provenance);
      else if (fetched) reportProvider?.(fetched.provenance);
      const instrumentId = readInstrumentId(quote) ?? resolveCanonicalInstrumentId(symbol);
      const comparison = reconciled?.comparison;
      const conflict = comparison?.state === 'material-conflict';
      const incomparable = comparison?.state === 'incomparable';
      const comparisonSummary = conflict
        ? ` Provider price conflict: ${comparison.candidates.map(
          (candidate) => `${candidate.provider}=${candidate.value} ${candidate.currency ?? ''}`
        ).join(' vs ')}. Treat this price as disputed.`
        : incomparable
          ? ' Provider quotes have different instrument, currency, or market-time semantics and cannot be directly compared.'
          : comparison?.state === 'insufficient-sources'
            ? ' Only one provider supplied this quote; no cross-provider check was possible.'
          : '';
      return {
        data: quote,
        provenance: {
          provider: 'longbridge',
          providerName: 'Longbridge',
          ...(instrumentId ? { instrumentId } : {}),
          fetchedAt: (ctx?.now ?? Date.now)(),
          marketTime: quote.timestamp * 1000,
          stale: false,
        },
        summary: `${formatQuote(quote)}${comparisonSummary}`,
        ...(comparison ? {
          evidence: {
            reconciliation: {
              providers: comparison.candidates.map((candidate) => candidate.provider),
              method: 'folio-quote/v1',
              comparisons: [{ metric: 'lastPrice', period: 'market.quote', result: comparison }],
            },
            lineage: [{
              kind: 'reconciliation' as const,
              description: `Compared ${comparison.sourceCount ?? 0} provider quotes: ${comparison.state}.`,
              version: 'folio-quote/v1',
            }],
          },
        } : {}),
      };
    },
  });
}

function resolveCanonicalInstrumentId(symbol: string): string | undefined {
  const resolution = DEFAULT_INSTRUMENT_RESOLVER.resolve(symbol, { providerId: 'longbridge' });
  return resolution.status === 'resolved' ? resolution.instrument.instrumentId : undefined;
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
