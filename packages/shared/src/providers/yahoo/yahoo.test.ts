import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import type { Kline, ProviderResult, Quote, StaticInfo } from '@finagent/core'
import { DEFAULT_INSTRUMENT_CATALOG } from '@finagent/core'
import { ProviderRouter } from '../router.ts'
import { TtlCache } from '../massive/cache.ts'
import { YahooChartFinancialDataProvider } from './adapter.ts'
import { createRouterFetchers } from '../router-fetchers.ts'
import { createMarketQuoteCapability } from '../../capabilities/manifests/market-quote.ts'
import { createMarketKlineCapability } from '../../capabilities/manifests/market-kline.ts'
import { createCompanyProfileCapability } from '../../capabilities/manifests/company-profile.ts'
import { buildFinancialEvidence } from '../../evidence/financial-evidence.ts'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

type FetchResponder = (url: string, init?: RequestInit) => Response

function installFetch(responder: FetchResponder): Array<{ url: string; init?: RequestInit }> {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    return responder(url, init)
  }) as typeof fetch
  return calls
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function chartPayload(overrides: Record<string, unknown> = {}) {
  return {
    chart: {
      result: [
        {
          meta: {
            exchangeTimezoneName: 'America/New_York',
            currency: 'USD',
            symbol: 'AAPL',
            exchangeName: 'NMS',
            fullExchangeName: 'NasdaqGS',
            instrumentType: 'EQUITY',
            regularMarketPrice: 190.5,
            regularMarketTime: 1_699_559_040,
            regularMarketVolume: 48_000_000,
            regularMarketDayHigh: 191.2,
            regularMarketDayLow: 188.4,
            previousClose: 189,
            longName: 'Apple Inc.',
            shortName: 'Apple',
            ...overrides,
          },
          timestamp: [1_699_472_640, 1_699_559_040],
          indicators: {
            quote: [
              {
                open: [188.1, 189.4],
                high: [190, 191.2],
                low: [187.5, 188.4],
                close: [189, 190.2],
                volume: [40_000_000, 48_000_000],
              },
            ],
          },
        },
      ],
      error: null,
    },
  }
}

function makeProvider(cache?: TtlCache<ProviderResult<unknown>>): YahooChartFinancialDataProvider {
  return new YahooChartFinancialDataProvider(cache ? { cache } : {})
}

describe('YahooChartFinancialDataProvider', () => {
  it('declares its identity, US market, and capabilities without an API key', async () => {
    const provider = makeProvider()
    expect(provider.id).toBe('yahoo')
    expect(provider.name).toBe('Yahoo Finance')
    expect(provider.kind).toBe('financial-data')
    expect(provider.markets()).toEqual([{ id: 'US', name: 'United States' }])
    expect(provider.capabilities()).toEqual(['market.quote', 'market.kline', 'company.profile'])

    const health = await provider.status()
    expect(health.status).toBe('connected')
    expect(health.message).toContain('No API key')
    expect(health.permissions).toEqual([
      { id: 'realtime', label: 'Real-time data', granted: false },
      { id: 'delayed-us', label: 'Delayed US quotes', granted: true },
    ])
  })

  it('maps a chart quote and sends a browser User-Agent', async () => {
    const calls = installFetch(() => jsonResponse(chartPayload()))
    const result = await makeProvider().execute<Quote>('market.quote', { symbol: 'AAPL.US' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toEqual({
      symbol: 'AAPL.US',
      lastPrice: 190.5,
      change: 1.5,
      changePercent: (1.5 / 189) * 100,
      volume: 48_000_000,
      timestamp: 1_699_559_040,
      high: 191.2,
      low: 188.4,
      open: 189.4,
      prevClose: 189,
    })
    expect(result.provenance.providerId).toBe('yahoo')
    expect(result.provenance.providerName).toBe('Yahoo Finance')
    expect(result.provenance.delayed).toBe(true)
    expect(result.provenance.stale).toBe(false)
    expect(result.provenance.marketTime).toBe(1_699_559_040_000)

    expect(calls[0].url).toContain('https://query1.finance.yahoo.com/v8/finance/chart/AAPL')
    expect(calls[0].url).toContain('interval=1d')
    expect(calls[0].url).toContain('range=1mo')
    expect(calls[0].url).toContain('events=splits')
    const headers = calls[0].init?.headers as Record<string, string>
    expect(headers['User-Agent']).toContain('Mozilla/5.0')
    expect(headers.Accept).toBe('application/json')
  })

  it('converts a canonical instrument through the Yahoo alias', async () => {
    const apple = DEFAULT_INSTRUMENT_CATALOG.find((item) => item.instrumentId === 'XNAS:AAPL')!
    const calls = installFetch(() => jsonResponse(chartPayload()))
    const result = await makeProvider().execute<Quote>('market.quote', { instrument: apple })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.instrumentId).toBe('XNAS:AAPL')
    expect(result.provenance.instrumentId).toBe('XNAS:AAPL')
    expect(calls[0].url).toContain('/chart/AAPL?')
  })

  it('falls back to a Massive alias when the catalog has no Yahoo symbol', async () => {
    const apple = DEFAULT_INSTRUMENT_CATALOG.find((item) => item.instrumentId === 'XNAS:AAPL')!
    const withoutYahoo = {
      ...apple,
      providerAliases: apple.providerAliases.filter((alias) => alias.providerId !== 'yahoo'),
    }
    const calls = installFetch(() => jsonResponse(chartPayload()))
    const result = await makeProvider().execute<Quote>('market.quote', { instrument: withoutYahoo })

    expect(result.ok).toBe(true)
    expect(calls[0].url).toContain('/chart/AAPL?')
  })

  it('maps SPX to the Yahoo S&P 500 index ticker', async () => {
    const calls = installFetch(() =>
      jsonResponse(chartPayload({ symbol: '^GSPC', longName: 'S&P 500', shortName: 'S&P 500' }))
    )
    const result = await makeProvider().execute<Quote>('market.quote', { symbol: 'SPX.US' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.symbol).toBe('SPX.US')
    expect(calls[0].url).toContain(`/chart/${encodeURIComponent('^GSPC')}?`)
  })

  it('maps class shares with a dot to Yahoo dash tickers', async () => {
    const calls = installFetch(() => jsonResponse(chartPayload({ symbol: 'BRK-B', longName: 'Berkshire' })))
    const result = await makeProvider().execute<Quote>('market.quote', { symbol: 'BRK.B.US' })

    expect(result.ok).toBe(true)
    expect(calls[0].url).toContain('/chart/BRK-B?')
  })

  it('maps daily candles, drops null bars, and keeps ascending order', async () => {
    installFetch(() =>
      jsonResponse({
        chart: {
          result: [
            {
              meta: { regularMarketPrice: 12 },
              timestamp: [1_700_000_000, 1_700_086_400, 1_700_172_800],
              indicators: {
                quote: [
                  {
                    open: [10, null, 12],
                    high: [11, null, 13],
                    low: [9, null, 11],
                    close: [10.5, null, 12.5],
                    volume: [100, null, 300],
                  },
                ],
              },
            },
          ],
        },
      })
    )
    const result = await makeProvider().execute<Kline[]>('market.kline', {
      symbol: 'AAPL.US',
      period: '1d',
      limit: 100,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toEqual([
      { symbol: 'AAPL.US', timestamp: 1_700_000_000, open: 10, high: 11, low: 9, close: 10.5, volume: 100 },
      { symbol: 'AAPL.US', timestamp: 1_700_172_800, open: 12, high: 13, low: 11, close: 12.5, volume: 300 },
    ])
    expect(result.provenance.marketTime).toBe(1_700_172_800_000)
    expect(result.provenance.delayed).toBe(true)
  })

  it('requests weekly candles with a multi-year range and slices to the limit', async () => {
    const calls = installFetch(() =>
      jsonResponse({
        chart: {
          result: [
            {
              timestamp: [1, 2, 3, 4],
              indicators: {
                quote: [
                  {
                    open: [1, 2, 3, 4],
                    high: [1, 2, 3, 4],
                    low: [1, 2, 3, 4],
                    close: [1, 2, 3, 4],
                    volume: [1, 1, 1, 1],
                  },
                ],
              },
            },
          ],
        },
      })
    )
    const result = await makeProvider().execute<Kline[]>('market.kline', {
      symbol: 'AAPL.US',
      period: '1w',
      limit: 2,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.map((bar) => bar.timestamp)).toEqual([3, 4])
    expect(calls[0].url).toContain('interval=1wk')
    expect(calls[0].url).toContain('range=2y')
  })

  it('rejects intraday candles and non-US symbols before calling the network', async () => {
    const calls = installFetch(() => jsonResponse(chartPayload()))
    const provider = makeProvider()

    const intraday = await provider.execute('market.kline', { symbol: 'AAPL.US', period: '1m' })
    const hongKong = await provider.execute('market.quote', { symbol: '0700.HK' })
    const unsupported = await provider.execute('market.intraday', { symbol: 'AAPL.US' })

    expect(intraday.ok).toBe(false)
    if (!intraday.ok) expect(intraday.error.code).toBe('UNSUPPORTED_CAPABILITY')
    expect(hongKong.ok).toBe(false)
    if (!hongKong.ok) expect(hongKong.error.code).toBe('UNSUPPORTED_CAPABILITY')
    expect(unsupported.ok).toBe(false)
    if (!unsupported.ok) expect(unsupported.error.code).toBe('UNSUPPORTED_CAPABILITY')
    expect(calls).toHaveLength(0)
  })

  it('maps a company profile from chart metadata', async () => {
    installFetch(() => jsonResponse(chartPayload()))
    const result = await makeProvider().execute<StaticInfo>('company.profile', { symbol: 'aapl.us' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toEqual({
      symbol: 'AAPL.US',
      name: 'Apple Inc.',
      exchange: 'NasdaqGS',
      currency: 'USD',
    })
    expect(result.provenance.delayed).toBe(true)
  })

  it('requires a symbol', async () => {
    const result = await makeProvider().execute('market.quote', {})
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('INVALID_INPUT')
  })

  it.each([
    [404, 'NOT_FOUND'],
    [429, 'RATE_LIMITED'],
    [503, 'UNKNOWN'],
  ] as const)('maps HTTP %s to %s without leaking the body', async (status, code) => {
    installFetch(() => jsonResponse({ secret: 'do-not-leak', chart: { result: null } }, status))
    const result = await makeProvider().execute('market.quote', { symbol: 'AAPL.US' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe(code)
    expect(result.error.message).not.toContain('do-not-leak')
    if (status === 429 || status === 503) expect(result.error.retryable).toBe(true)
  })

  it('maps a missing chart result and invalid JSON to stable errors', async () => {
    installFetch(() =>
      jsonResponse({
        chart: { result: null, error: { code: 'Not Found', description: 'Yahoo internal crumb missing' } },
      })
    )
    const missing = await makeProvider().execute('market.quote', { symbol: 'AAPL.US' })
    expect(missing.ok).toBe(false)
    if (!missing.ok) {
      expect(missing.error.code).toBe('NOT_FOUND')
      expect(missing.error.message).not.toContain('crumb')
    }

    globalThis.fetch = (async (_input: unknown, _init?: RequestInit) =>
      new Response('not-json', { status: 200 })) as typeof fetch
    const parsed = await makeProvider().execute('market.quote', { symbol: 'AAPL.US' })
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error.code).toBe('PARSE_FAILURE')
  })

  it('returns ABORTED when the signal is already aborted', async () => {
    const calls = installFetch(() => jsonResponse(chartPayload()))
    const controller = new AbortController()
    controller.abort()
    const result = await makeProvider().execute('market.quote', { symbol: 'AAPL.US' }, controller.signal)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('ABORTED')
    expect(calls).toHaveLength(0)
  })

  it('distinguishes a timed-out request from a user abort', async () => {
    globalThis.fetch = ((_input: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      })) as typeof fetch
    const result = await makeProvider().execute(
      'market.quote',
      { symbol: 'AAPL.US' },
      AbortSignal.timeout(1)
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('TIMEOUT')
    expect(result.error.retryable).toBe(true)
  })

  it('serves repeated quotes from cache and refetches after the TTL', async () => {
    const calls = installFetch(() => jsonResponse(chartPayload()))
    const provider = makeProvider()
    await provider.execute('market.quote', { symbol: 'AAPL.US' })
    await provider.execute('market.quote', { symbol: 'AAPL.US' })
    expect(calls).toHaveLength(1)

    const short = makeProvider(new TtlCache<ProviderResult<unknown>>({ ttlMs: 10 }))
    await short.execute('market.quote', { symbol: 'MSFT.US' })
    await Bun.sleep(20)
    await short.execute('market.quote', { symbol: 'MSFT.US' })
    expect(calls).toHaveLength(3)

    short.clearCache()
    await short.execute('market.quote', { symbol: 'MSFT.US' })
    expect(calls).toHaveLength(4)
  })

  it('answers US quotes after earlier providers fail', async () => {
    installFetch(() => jsonResponse(chartPayload()))
    const router = new ProviderRouter()
    router.register({
      kind: 'financial-data',
      id: 'longbridge',
      name: 'Longbridge',
      status: async () => ({ status: 'not-connected', lastCheck: 0 }),
      capabilities: () => ['market.quote', 'market.kline', 'company.profile'],
      markets: () => [{ id: 'US', name: 'United States' }],
      execute: async () => ({ ok: false, error: { code: 'AUTH_EXPIRED', message: 'not connected' } }),
    })
    router.register({
      kind: 'financial-data',
      id: 'massive',
      name: 'Massive (Polygon.io)',
      status: async () => ({ status: 'not-connected', lastCheck: 0 }),
      capabilities: () => ['market.quote', 'market.kline', 'company.profile'],
      markets: () => [{ id: 'US', name: 'United States' }],
      execute: async () => ({ ok: false, error: { code: 'CONFIG_MISSING', message: 'Add an API key to connect' } }),
    })
    router.register(makeProvider())
    router.setRouting({ primary: 'longbridge', fallback: 'massive' })

    const result = await router.execute<Quote>('market.quote', { symbol: 'AAPL.US' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.provenance.providerId).toBe('yahoo')
    expect(result.provenance.providerName).toBe('Yahoo Finance')
    expect(result.data.lastPrice).toBe(190.5)
    expect(router.coverage().find((entry) => entry.providerId === 'yahoo')).toMatchObject({
      dataAccess: 'delayed',
      credentialRequirement: 'none',
      markets: [{ id: 'US', name: 'United States' }],
    })
  })
})

// These are synthetic, session-aligned chart responses, not live Yahoo proof.
function sessionChart(quoteTime = '2025-10-17T17:00:00Z') {
  const payload = chartPayload({
    regularMarketTime: Date.parse(quoteTime) / 1000,
    regularMarketPrice: 108,
    // Range baselines must never be mistaken for the previous session close.
    previousClose: 90,
    chartPreviousClose: 80,
  });
  const chart = payload.chart.result[0];
  chart.timestamp = ['2025-10-15', '2025-10-16', '2025-10-17'].map(day => Date.parse(`${day}T13:30:00Z`) / 1000);
  chart.indicators.quote[0] = {
    open: [99, 101, 106], high: [101, 106, 109], low: [98, 100, 105],
    close: [100, 105, 108], volume: [1, 2, 3],
  };
  return payload;
}

describe('Yahoo previous trading-session baseline', () => {
  it.each([
    ['intraday', '2025-10-17T17:00:00Z', '2025-10-17T17:01:00Z'],
    ['after hours', '2025-10-17T20:00:00Z', '2025-10-17T23:00:00Z'],
    ['weekend', '2025-10-17T20:00:00Z', '2025-10-19T12:00:00Z'],
    ['Monday premarket', '2025-10-17T20:00:00Z', '2025-10-20T12:00:00Z'],
  ])('anchors %s to regularMarketTime rather than today', async (_label, quoteTime, now) => {
    const clock = spyOn(Date, 'now').mockReturnValue(Date.parse(now));
    try {
      installFetch(() => jsonResponse(sessionChart(quoteTime)));
      const result = await makeProvider().execute<Quote>('market.quote', { symbol: 'AAPL.US' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.prevClose).toBe(105);
      expect(result.data.change).toBe(3);
      expect(result.data.changePercent).toBeCloseTo(100 * 3 / 105);
      expect(result.data.timestamp).toBe(Date.parse(quoteTime) / 1000);
    } finally { clock.mockRestore(); }
  });

  it('retains null current-day slots and uses the immediately preceding close', async () => {
    const payload = sessionChart();
    payload.chart.result[0].indicators.quote[0].close = [100, 105, null] as unknown as number[];
    installFetch(() => jsonResponse(payload));
    const result = await makeProvider().execute<Quote>('market.quote', { symbol: 'AAPL.US' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.prevClose).toBe(105);
  });

  it('keeps equal consecutive closes as distinct sessions', async () => {
    const payload = sessionChart();
    payload.chart.result[0].indicators.quote[0].close = [100, 105, 105];
    installFetch(() => jsonResponse(payload));
    const result = await makeProvider().execute<Quote>('market.quote', { symbol: 'AAPL.US' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.prevClose).toBe(105);
  });

  it('uses exchange dates when UTC date has already advanced', async () => {
    installFetch(() => jsonResponse(sessionChart('2025-10-18T00:30:00Z')));
    const result = await makeProvider().execute<Quote>('market.quote', { symbol: 'AAPL.US' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.prevClose).toBe(105);
  });

  it.each([
    'empty bars', 'missing previous bar', 'null previous close', 'missing quote-day bar',
    'invalid timestamp slot', 'missing timezone', 'invalid timezone', 'missing quote time',
    'missing regular price', 'split at quote session', 'unverifiable split', 'holiday gap',
  ])('returns unavailable for %s instead of inventing a daily move', async scenario => {
    const payload: any = sessionChart();
    const chart = payload.chart.result[0];
    if (scenario === 'empty bars') chart.timestamp = [];
    if (scenario === 'missing previous bar') {
      chart.timestamp.splice(1, 1);
      for (const values of Object.values(chart.indicators.quote[0]) as number[][]) values.splice(1, 1);
    }
    if (scenario === 'null previous close') chart.indicators.quote[0].close[1] = null;
    if (scenario === 'missing quote-day bar') chart.timestamp.pop();
    if (scenario === 'invalid timestamp slot') chart.timestamp[1] = null;
    if (scenario === 'missing timezone') delete chart.meta.exchangeTimezoneName;
    if (scenario === 'invalid timezone') chart.meta.exchangeTimezoneName = 'Invalid/Zone';
    if (scenario === 'missing quote time') delete chart.meta.regularMarketTime;
    if (scenario === 'missing regular price') delete chart.meta.regularMarketPrice;
    if (scenario === 'split at quote session') {
      chart.events = { splits: { split: { date: chart.timestamp[2], numerator: 4, denominator: 1 } } };
      chart.indicators.quote[0].close[1] = 420;
    }
    if (scenario === 'unverifiable split') chart.events = { splits: { split: { numerator: 4, denominator: 1 } } };
    if (scenario === 'holiday gap') {
      // Tuesday after a closed Monday: without a calendar, do not call Friday
      // 'yesterday' or silently report an unverified multi-day change.
      chart.meta.regularMarketTime = Date.parse('2025-10-21T17:00:00Z') / 1000;
      chart.timestamp[2] = Date.parse('2025-10-21T13:30:00Z') / 1000;
    }
    installFetch(() => jsonResponse(payload));
    const result = await makeProvider().execute<Quote>('market.quote', { symbol: 'AAPL.US' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('does not apply a historical split ratio again to already adjusted daily closes', async () => {
    const payload: any = sessionChart();
    payload.chart.result[0].events = { splits: { earlier: { date: Date.parse('2025-10-14T13:30:00Z') / 1000, numerator: 4, denominator: 1 } } };
    installFetch(() => jsonResponse(payload));
    const result = await makeProvider().execute<Quote>('market.quote', { symbol: 'AAPL.US' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.change).toBe(3);
  });

  it.each(['2025-10-17T21:00:00Z', '2025-10-20T13:30:00Z'])(
    'returns unavailable when a later split may have adjusted bars ahead of the quote (%s)',
    async splitDate => {
      // Synthetic asynchronous-basis response, not a claim about live Yahoo:
      // Friday's regular price is still pre-split while daily Close values
      // already reflect a 4:1 split dated after that quote (including Monday).
      const payload: any = sessionChart('2025-10-17T20:00:00Z');
      const chart = payload.chart.result[0];
      chart.meta.regularMarketPrice = 400;
      chart.indicators.quote[0].close = [98, 99, 100];
      chart.events = { splits: { later: {
        date: Date.parse(splitDate) / 1000, numerator: 4, denominator: 1,
      } } };
      installFetch(() => jsonResponse(payload));

      const result = await makeProvider().execute<Quote>('market.quote', { symbol: 'AAPL.US' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
        expect(result.error.message).toContain('previous trading-session close could not be verified');
      }
    }
  );
});


it('deduplicates daily sessions before selecting the previous close', async () => {
  const payload = sessionChart();
  const chart = payload.chart.result[0];
  chart.timestamp = [chart.timestamp[0], chart.timestamp[1], chart.timestamp[1] + 60, chart.timestamp[2], chart.timestamp[2] + 60];
  chart.indicators.quote[0].close = [100, 104, 105, 107, 108];
  installFetch(() => jsonResponse(payload));
  const result = await makeProvider().execute<Quote>('market.quote', { symbol: 'AAPL.US' });
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.data.prevClose).toBe(105);
});

it('does not skip a null final duplicate of the previous session', async () => {
  const payload: any = sessionChart();
  const chart = payload.chart.result[0];
  chart.timestamp.splice(2, 0, chart.timestamp[1] + 60);
  chart.indicators.quote[0].close = [100, 105, null, 108];
  installFetch(() => jsonResponse(payload));
  const result = await makeProvider().execute<Quote>('market.quote', { symbol: 'AAPL.US' });
  expect(result.ok).toBe(false);
});

it('preserves actual Yahoo provenance and fallback through all three capability evidence envelopes', async () => {
  installFetch(() => jsonResponse(chartPayload()));
  const router = new ProviderRouter();
  router.register({
    kind: 'financial-data', id: 'longbridge', name: 'Longbridge',
    capabilities: () => ['market.quote', 'market.kline', 'company.profile'],
    markets: () => [{ id: 'US', name: 'United States' }],
    status: async () => ({ status: 'not-connected', lastCheck: 1 }),
    execute: async <T>() => ({ ok: false as const, error: { code: 'CONFIG_MISSING', message: 'Synthetic primary unavailable' } }) as ProviderResult<T>,
  });
  router.register(makeProvider());
  router.setRouting({ primary: 'longbridge', fallback: 'yahoo' });
  const fetchers = createRouterFetchers(router);
  const cases = [
    { capability: createMarketQuoteCapability(fetchers), input: { symbol: 'AAPL.US' } },
    { capability: createMarketKlineCapability(fetchers), input: { symbol: 'AAPL.US', period: '1d' as const, limit: 5 } },
    { capability: createCompanyProfileCapability(fetchers), input: { symbol: 'AAPL.US' } },
  ];
  for (const { capability, input } of cases) {
    const result = await capability.execute(input);
    expect(router.lastResultFor('yahoo')).toMatchObject({ providerId: 'yahoo', ok: true, fallbackUsed: true });
    expect(result.provenance).toMatchObject({ provider: 'yahoo', providerId: 'yahoo', delayed: true, stale: false });
    expect(result.evidence?.fallback).toMatchObject({ from: 'longbridge', to: 'yahoo' });
    const [envelope] = buildFinancialEvidence({ sessionId: 'synthetic', runId: 'r', toolCalls: [{
      id: capability.id, toolName: capability.toolName, args: input,
      startedAt: 1, status: 'success', result,
    }] });
    expect(envelope.provider).toBe('yahoo');
    expect(envelope.delayed).toBe(true);
    expect(envelope.fallback).toMatchObject({ from: 'longbridge', to: 'yahoo' });
    expect(envelope.lineage[0].description).toBe(`Retrieved ${capability.id} from yahoo.`);
  }
});


it('uses Friday Close for a Monday quote and never dividend-adjusted Adj Close', async () => {
  const payload: any = sessionChart('2025-10-20T17:00:00Z');
  const chart = payload.chart.result[0];
  chart.timestamp = ['2025-10-16', '2025-10-17', '2025-10-20'].map(day => Date.parse(`${day}T13:30:00Z`) / 1000);
  chart.indicators.quote[0].close = [100, 105, 108];
  chart.indicators.adjclose = [{ adjclose: [98, 103, 108] }];
  installFetch(() => jsonResponse(payload));
  const result = await makeProvider().execute<Quote>('market.quote', { symbol: 'AAPL.US' });
  expect(result.ok).toBe(true);
  if (result.ok) { expect(result.data.prevClose).toBe(105); expect(result.data.change).toBe(3); }
});
