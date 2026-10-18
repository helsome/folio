import { Type } from '@sinclair/typebox';
import {
  DEFAULT_INSTRUMENT_CATALOG,
  InstrumentResolver,
  readInstrumentId,
  describeFact,
  marketCurrencyOf,
  quoteToFacts,
} from '@finagent/core';
import type {
  FactTiming,
  FinanceCapability,
  FinancialFact,
  ProviderProvenance,
  Quote,
} from '@finagent/core';
import { defineCapability } from '../define.ts';
import { normalizeSymbol } from '../validate.ts';
import type { CapabilityFetchers } from '../fetchers.ts';
import { defaultCapabilityFetchers } from '../fetchers.ts';

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
      const fetched = fetchers.getQuoteResult
        ? await fetchers.getQuoteResult(symbol, ctx?.signal)
        : undefined;
      const quote = fetched?.data ?? await fetchers.getQuote(symbol);
      if (fetched) reportProvider?.(fetched.provenance);
      const prov = fetched?.provenance;
      const instrumentId =
        readInstrumentId(quote) ?? prov?.instrumentId ?? resolveCanonicalInstrumentId(symbol);
      const provider = prov?.providerId ?? 'longbridge';
      const providerName = prov?.providerName ?? 'Longbridge';
      const fetchedAt = prov?.fetchedAt ?? (ctx?.now ?? Date.now)();
      const timing: FactTiming = resolveFactTiming(prov);
      const stale = prov?.stale ?? false;

      // Native currency is derived from the market code (structured, not free
      // text). Timing, provider, and retrievedAt faithfully mirror the actual
      // provider provenance when available, falling back safely without guessing.
      const facts = quoteToFacts(quote, {
        instrumentId,
        provider,
        currency: marketCurrencyOf(symbol),
        timing,
        retrievedAt: Math.floor(fetchedAt / 1000),
      });
      return {
        data: quote,
        facts,
        provenance: {
          provider,
          providerName,
          ...(instrumentId ? { instrumentId } : {}),
          fetchedAt,
          marketTime: quote.timestamp * 1000,
          ...(prov?.delayed !== undefined ? { delayed: prov.delayed } : {}),
          stale,
        },
        summary: formatQuote(quote, facts),
      };
    },
  });
}

function resolveFactTiming(provenance?: ProviderProvenance): FactTiming {
  if (provenance?.delayed === true) return 'delayed';
  if (provenance?.delayed === false) return 'live';
  return 'unknown';
}

function resolveCanonicalInstrumentId(symbol: string): string | undefined {
  const resolution = DEFAULT_INSTRUMENT_RESOLVER.resolve(symbol, { providerId: 'longbridge' });
  return resolution.status === 'resolved' ? resolution.instrument.instrumentId : undefined;
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
