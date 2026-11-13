import { afterEach, describe, expect, it } from 'bun:test';
import type { FinancialDataProvider } from '@finagent/core';
import { createMarketQuoteCapability } from '../capabilities/manifests/market-quote.ts';
import { createRouterFetchers } from '../providers/router-fetchers.ts';
import { ProviderRouter } from '../providers/router.ts';
import { YahooChartFinancialDataProvider } from '../providers/yahoo/adapter.ts';
import { buildAnswerEvidenceTrace } from './answer-trace.ts';
import { parseEvidenceBundle, serializeEvidenceBundle } from './contract.ts';
import { buildFinancialEvidence } from './financial-evidence.ts';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

// Controlled Yahoo HTTP fixture, not a live quote. Consecutive trading days
// satisfy the production adapter's previous-close integrity checks.
const chart = {
  chart: {
    result: [{
      meta: {
        symbol: 'AAPL',
        exchangeTimezoneName: 'America/New_York',
        regularMarketPrice: 190.5,
        regularMarketTime: 1_699_559_040,
        regularMarketVolume: 48_000_000,
        regularMarketDayHigh: 191.2,
        regularMarketDayLow: 188.4,
      },
      timestamp: [1_699_472_640, 1_699_559_040],
      indicators: { quote: [{
        open: [188.1, 189.4], high: [190, 191.2], low: [187.5, 188.4],
        close: [189, 190.2], volume: [40_000_000, 48_000_000],
      }] },
    }],
    error: null,
  },
};

function unavailable(id: string): FinancialDataProvider {
  return {
    kind: 'financial-data', id, name: id,
    status: async () => ({ status: 'not-connected', lastCheck: 0 }),
    capabilities: () => ['market.quote'],
    markets: () => [{ id: 'US', name: 'United States' }],
    execute: async () => ({ ok: false, error: { code: 'CONFIG_MISSING', message: 'Not configured' } }),
  };
}

function capability() {
  const router = new ProviderRouter();
  // Stubs never contact Longbridge, Massive, or any user account.
  router.register(unavailable('longbridge'));
  router.register(unavailable('massive'));
  router.register(new YahooChartFinancialDataProvider());
  router.setRouting({ primary: 'longbridge', fallback: 'massive' });
  return createMarketQuoteCapability(createRouterFetchers(router));
}

describe('answer trace Yahoo production wiring (controlled HTTP fixture)', () => {
  it('preserves fallback source, milliseconds, delayed feed and citations through bundle reload', async () => {
    const requests: string[] = [];
    globalThis.fetch = (async (input: unknown) => {
      requests.push(String(input));
      return Response.json(chart);
    }) as typeof fetch;
    const result = await capability().execute({ symbol: 'AAPL.US' });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toStartWith('https://query1.finance.yahoo.com/v8/finance/chart/AAPL?');
    expect(result.provenance).toMatchObject({
      provider: 'yahoo', providerName: 'Yahoo Finance', delayed: true,
      marketTime: 1_699_559_040_000, stale: false,
    });
    expect(result.data.source).toEqual({ providerId: 'yahoo', providerName: 'Yahoo Finance', delayed: true });

    const financialEvidence = buildFinancialEvidence({
      sessionId: 'yahoo-fixture', runId: 'quote-run',
      toolCalls: [{
        id: 'quote-1', toolName: 'get_quote', args: { symbol: 'AAPL.US' },
        status: 'success', startedAt: 1, completedAt: 2, result,
      }],
    });
    const envelope = financialEvidence[0]!;
    expect(envelope).toMatchObject({
      provider: 'yahoo', delayed: true, asOf: 1_699_559_040_000,
      retrievedAt: result.provenance.fetchedAt,
      fallback: { from: 'longbridge', to: 'yahoo' },
    });
    const trace = buildAnswerEvidenceTrace({
      sessionId: 'yahoo-fixture', runId: 'quote-run', question: 'AAPL quote?', financialEvidence,
      answer: ['~~~folio-block', JSON.stringify({
        version: 1, type: 'metric_grid',
        metrics: [{ label: 'Last price', value: result.data.lastPrice, unit: 'price', currency: 'USD' }],
        evidenceIds: [envelope.id, 'fe_missing'],
      }), '~~~'].join('\n'),
    });
    expect(trace.bundle.sources[0]!.publisher).toBe('yahoo');
    expect(trace.bundle.sources[0]!.providerMeta?.fallback).toMatchObject({ to: 'yahoo' });
    const price = trace.bundle.evidence.find((item) => item.financial?.metric === 'lastPrice')!;
    expect(price.financial).toMatchObject({ value: 190.5, asOf: 1_699_559_040_000 });
    expect(price.provenance).toMatchObject({ provider: 'yahoo', envelopeId: envelope.id });
    expect(price.freshness).toEqual({
      retrievedAt: result.provenance.fetchedAt, asOf: 1_699_559_040_000, delayed: true, stale: false,
    });
    expect(trace.citations[0]!.mappedEvidenceIds).toContain(price.evidenceId);
    expect(trace.citations[0]!.unmappedEvidenceIds).toEqual(['fe_missing']);
    expect(trace.bundle.evidence.every((item) => item.freshness.delayed === true)).toBe(true);
    expect(parseEvidenceBundle(serializeEvidenceBundle(trace.bundle))).toEqual(trace.bundle);
  });

  it('reports a failed public quote without constructing a zero-price evidence record', async () => {
    globalThis.fetch = (async (_input: unknown, _init?: RequestInit) =>
      Response.json({ chart: { result: null } }, { status: 429 })) as typeof fetch;
    await expect(capability().execute({ symbol: 'AAPL.US' })).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(buildFinancialEvidence({
      sessionId: 'yahoo-fixture', runId: 'failed-run',
      toolCalls: [{ id: 'quote-1', toolName: 'get_quote', args: { symbol: 'AAPL.US' }, status: 'error', startedAt: 1 }],
    })).toEqual([]);
  });
});
