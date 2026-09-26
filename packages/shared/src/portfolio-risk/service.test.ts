import { describe, expect, it } from 'bun:test';
import { Type, type TSchema } from '@sinclair/typebox';
import type {
  FinanceCapability,
  Kline,
  NewsItem,
  PortfolioSnapshot,
  Holding,
  Quote,
} from '@finagent/core';
import { defineCapability } from '../capabilities/define.ts';
import type { CapabilityFetchers } from '../capabilities/fetchers.ts';
import { createMarketQuoteCapability } from '../capabilities/manifests/market-quote.ts';
import { createPortfolioSummaryCapability } from '../capabilities/manifests/portfolio-summary.ts';
import { createPortfolioPositionsCapability, createResearchEventsCapability } from '../capabilities/manifests/phase-two.ts';
import { createCapabilityRegistry } from '../capabilities/registry.ts';
import { CapabilityExecutor } from '../capabilities/executor.ts';
import {
  PortfolioRiskService,
  type PortfolioRiskSynthesisInput,
  type PortfolioRiskSynthesizer,
} from './service.ts';

const FIXED_NOW = 1786723200000; // 2026-08-13T00:00:00Z
const DAY_MS = 24 * 60 * 60 * 1000;

const emptySchema = Type.Object({});
const symbolSchema = Type.Object({ symbol: Type.String() });
const klineSchema = Type.Object({
  symbol: Type.String(),
  period: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Number()),
});

// ── Test doubles ───────────────────────────────────────────────────────────

function makeCap(
  id: string,
  toolName: string,
  schema: TSchema,
  getData: (input: unknown) => unknown
): FinanceCapability {
  return defineCapability({
    id,
    name: id,
    description: 'test capability',
    category: 'market',
    riskLevel: 'read',
    auth: 'public',
    toolName,
    inputSchema: schema,
    async execute(input, ctx) {
      return {
        data: getData(input),
        provenance: { provider: 'test', fetchedAt: (ctx?.now ?? Date.now)(), stale: false },
      };
    },
  });
}

/**
 * The real `research.events` capability bound to a stub finance calendar, so
 * the tests exercise its actual input contract (required `eventType`, bare
 * `CalendarEvent[]` payload) instead of a hand-rolled look-alike.
 */
function calendarCap(
  events: Array<{ symbol: string; type: string; date: number }>
): FinanceCapability {
  return createResearchEventsCapability({
    getCalendarEvents: async () => events,
  } as unknown as CapabilityFetchers);
}

function makeService(
  capabilities: FinanceCapability[],
  synthesizer?: PortfolioRiskSynthesizer
): PortfolioRiskService {
  return new PortfolioRiskService({
    registry: createCapabilityRegistry(capabilities),
    executor: new CapabilityExecutor({ now: () => FIXED_NOW }),
    synthesizer,
    now: () => FIXED_NOW,
  });
}

function readSymbol(input: unknown): string {
  if (typeof input === 'object' && input !== null && 'symbol' in input && typeof input.symbol === 'string') {
    return input.symbol;
  }
  return '';
}

function holding(symbol: string, overrides: Partial<Holding> = {}): Holding {
  return {
    symbol,
    name: symbol,
    currency: 'USD',
    quantity: 1,
    costPrice: 1,
    marketPrice: 1,
    marketValue: 0,
    unrealizedPnL: 0,
    unrealizedPnLPercent: 0,
    ...overrides,
  };
}

function portfolio(holdings: Holding[], marketValue?: number): PortfolioSnapshot {
  return {
    baseCurrency: 'USD',
    totalAssets: marketValue ?? holdings.reduce((sum, h) => sum + (h.marketValue ?? 0), 0),
    marketValue,
    cash: 0,
    accounts: [],
    holdings,
    fetchedAt: FIXED_NOW,
  };
}

function quote(symbol: string, lastPrice: number): Quote {
  return {
    symbol,
    lastPrice,
    change: 0,
    changePercent: 0,
    volume: 0,
    timestamp: 0,
    high: lastPrice,
    low: lastPrice,
    open: lastPrice,
    prevClose: lastPrice,
  };
}

function flatKlines(symbol: string, high: number, close: number): Kline[] {
  return Array.from({ length: 25 }, (_, i) => ({
    symbol,
    timestamp: FIXED_NOW + i,
    open: close,
    high,
    low: close,
    close,
    volume: 1,
  }));
}

function news(symbol: string, timestampsSec: number[]): NewsItem[] {
  return timestampsSec.map((ts, i) => ({
    id: `${symbol}-${i}`,
    title: 'News',
    summary: '',
    url: '',
    timestamp: ts,
    symbols: [symbol],
  }));
}

const summaryCap = (data: PortfolioSnapshot) =>
  makeCap('portfolio.summary', 'get_portfolio', emptySchema, () => data);
const positionsCap = (data: Holding[]) =>
  makeCap('portfolio.positions', 'get_positions', emptySchema, () => data);
const quoteCap = (price = 10) =>
  makeCap('market.quote', 'get_quote', symbolSchema, (input) => quote(readSymbol(input), price));

// ── Tests ──────────────────────────────────────────────────────────────────

describe('PortfolioRiskService allocation + concentration', () => {
  it('preserves currency coverage through production capability manifests and executor', async () => {
    const data = portfolio([
      holding('AAPL.US', { marketValue: 20_000 }),
      holding('0700.HK', { currency: 'HKD', marketValue: 780_000 }),
    ], 100_000);
    const requestedQuotes: string[] = [];
    const fetchers = {
      getPortfolio: async () => data,
      getAccountPositions: async () => data.holdings,
      getQuote: async (symbol: string) => {
        requestedQuotes.push(symbol);
        return quote(symbol, 10);
      },
    } as unknown as CapabilityFetchers;
    const report = await makeService([
      createPortfolioSummaryCapability(fetchers),
      createPortfolioPositionsCapability(fetchers),
      createMarketQuoteCapability(fetchers),
    ]).analyze();

    expect(requestedQuotes.sort()).toEqual(['0700.HK', 'AAPL.US']);
    expect(report.capabilityRuns.filter((run) =>
      ['portfolio.summary', 'portfolio.positions', 'market.quote'].includes(run.capabilityId)
    ).every((run) => run.status === 'success')).toBe(true);
    expect(report.allocation).toEqual([{ symbol: 'AAPL.US', marketValue: 20_000, weight: 0.2 }]);
    expect(report.allocationCoverage).toEqual({ excludedSymbols: ['0700.HK'], basis: 'portfolio' });
  });

  it('does not treat unconverted HKD as USD in portfolio weights or risk signals', async () => {
    const data = portfolio([
      holding('AAA.US', { marketValue: 20_000 }),
      holding('0700.HK', { currency: 'HKD', marketValue: 780_000 }),
    ], 100_000);
    const report = await makeService([summaryCap(data), positionsCap(data.holdings), quoteCap()]).analyze();

    expect(report.allocation).toEqual([{ symbol: 'AAA.US', marketValue: 20_000, weight: 0.2 }]);
    expect(report.concentration.top1Weight).toBeCloseTo(0.2);
    expect(report.signals.some((signal) => signal.kind === 'concentration')).toBe(false);
    expect(report.allocationCoverage?.excludedSymbols).toEqual(['0700.HK']);
    expect(report.allocationCoverage?.basis).toBe('portfolio');
  });

  it('keeps converted values and same-currency raw values, including a true zero', async () => {
    const data = portfolio([
      holding('0700.HK', { currency: 'HKD', marketValue: 780_000, marketValueBase: 10_000 }),
      holding('AAA.US', { marketValue: 20_000 }),
      holding('ZERO.HK', { currency: 'HKD', marketValue: 500_000, marketValueBase: 0 }),
    ], 100_000);
    const report = await makeService([summaryCap(data), positionsCap(data.holdings)]).analyze();

    expect(report.allocation.map((item) => [item.symbol, item.weight])).toEqual([
      ['AAA.US', 0.2], ['0700.HK', 0.1],
    ]);
    expect(report.allocationCoverage?.excludedSymbols).toEqual([]);
  });

  it('does not use a foreign-currency quote as a base-currency fallback', async () => {
    const data = portfolio([
      holding('0700.HK', { currency: 'HKD', marketValue: 0, quantity: 100 }),
      holding('AAA.US', { marketValue: 0, quantity: 10 }),
    ], 1_000);
    const quotes = makeCap('market.quote', 'get_quote', symbolSchema, (input) =>
      quote(readSymbol(input), 10)
    );
    const report = await makeService([summaryCap(data), positionsCap(data.holdings), quotes]).analyze();

    expect(report.allocation).toEqual([{ symbol: 'AAA.US', marketValue: 100, weight: 0.1 }]);
    expect(report.allocationCoverage?.excludedSymbols).toEqual(['0700.HK']);
  });

  it('marks subset weights as partial when the portfolio total is unavailable', async () => {
    const data = portfolio([
      holding('AAA.US', { marketValue: 20 }),
      holding('0700.HK', { currency: 'HKD', marketValue: 780 }),
    ]);
    data.marketValue = undefined;
    const report = await makeService([summaryCap(data), positionsCap(data.holdings)]).analyze();

    expect(report.allocation).toEqual([{ symbol: 'AAA.US', marketValue: 20, weight: 1 }]);
    expect(report.allocationCoverage).toEqual({ excludedSymbols: ['0700.HK'], basis: 'available-positions' });
    expect(report.signals.some((signal) => ['concentration', 'large_position', 'sector_exposure'].includes(signal.kind))).toBe(false);
    expect(report.summary).toContain('available positions only');
  });

  it('computes allocation weights and concentration from a portfolio', async () => {
    const data = portfolio([
      holding('AAA.US', { marketValue: 400 }),
      holding('BBB.US', { marketValue: 300 }),
      holding('CCC.US', { marketValue: 200 }),
      holding('DDD.US', { marketValue: 100 }),
    ]);
    const service = makeService([summaryCap(data), positionsCap(data.holdings), quoteCap()]);

    const report = await service.analyze();

    expect(report.allocation.map((a) => a.symbol)).toEqual([
      'AAA.US',
      'BBB.US',
      'CCC.US',
      'DDD.US',
    ]);
    expect(report.allocation[0].weight).toBeCloseTo(0.4, 5);
    expect(report.concentration.top1Weight).toBeCloseTo(0.4, 5);
    expect(report.concentration.top5Weight).toBeCloseTo(1.0, 5);
    expect(report.concentration.herfindahl).toBeCloseTo(0.3, 5);
  });

  it('derives market value from the quote when positions lack it', async () => {
    const service = makeService([
      summaryCap({ baseCurrency: "USD", accounts: [], holdings: [], fetchedAt: 0 }),
      positionsCap([holding('AAA.US', { quantity: 10, marketValue: 0 })]),
      quoteCap(12),
    ]);

    const report = await service.analyze();

    expect(report.allocation).toHaveLength(1);
    expect(report.allocation[0].marketValue).toBeCloseTo(120, 5);
  });
});

describe('PortfolioRiskService partial data', () => {
  it('excludes a position whose quote is missing and records the failure', async () => {
    const service = makeService([
      summaryCap({ baseCurrency: "USD", accounts: [], holdings: [], fetchedAt: 0 }),
      positionsCap([
        holding('AAA.US', { quantity: 10, marketValue: 0 }),
        holding('BAD.US', { quantity: 5, marketValue: 0 }),
      ]),
      makeCap('market.quote', 'get_quote', symbolSchema, (input) => {
        const symbol = readSymbol(input);
        if (symbol === 'BAD.US') throw new Error('quote unavailable');
        return quote(symbol, 10);
      }),
    ]);

    const report = await service.analyze();

    expect(report.allocation.map((a) => a.symbol)).toEqual(['AAA.US']);
    expect(report.allocation[0].marketValue).toBeCloseTo(100, 5);
    expect(
      report.capabilityRuns.some((r) => r.capabilityId === 'market.quote' && r.status === 'failed')
    ).toBe(true);
  });

  it('skips the earnings signal and notes a missing research.events capability', async () => {
    const data = portfolio([holding('AAA.US', { marketValue: 100 })]);
    const service = makeService([summaryCap(data), positionsCap(data.holdings)]);

    const report = await service.analyze();

    expect(report.signals.some((s) => s.kind === 'upcoming_earnings')).toBe(false);
    expect(
      report.capabilityRuns.some(
        (r) => r.capabilityId === 'research.events' && r.status === 'unavailable'
      )
    ).toBe(true);
  });
});

describe('PortfolioRiskService signals', () => {
  it('flags high concentration when the top position exceeds 30%', async () => {
    const data = portfolio([
      holding('AAA.US', { marketValue: 40 }),
      holding('BBB.US', { marketValue: 30 }),
      holding('CCC.US', { marketValue: 30 }),
    ]);
    const service = makeService([summaryCap(data), positionsCap(data.holdings), quoteCap()]);

    const report = await service.analyze();

    expect(report.signals.find((s) => s.kind === 'concentration')?.severity).toBe('high');
  });

  it('emits an earnings signal only when an event falls within the 7-day horizon', async () => {
    const data = portfolio([holding('AAA.US', { marketValue: 100 })]);
    const seconds = (deltaMs: number) => (FIXED_NOW + deltaMs) / 1000;

    const within = makeService([
      summaryCap(data),
      positionsCap(data.holdings),
      quoteCap(),
      calendarCap([{ symbol: 'AAA.US', type: 'financial', date: seconds(3 * DAY_MS) }]),
    ]);
    expect((await within.analyze()).signals.some((s) => s.kind === 'upcoming_earnings')).toBe(true);

    const outside = makeService([
      summaryCap(data),
      positionsCap(data.holdings),
      quoteCap(),
      calendarCap([{ symbol: 'AAA.US', type: 'financial', date: seconds(30 * DAY_MS) }]),
    ]);
    expect((await outside.analyze()).signals.some((s) => s.kind === 'upcoming_earnings')).toBe(false);
  });

  it('batches research.events by 10 held symbols and reads the bare event array', async () => {
    const holdings = Array.from({ length: 12 }, (_, i) => holding(`AAA${i}.US`, { marketValue: 10 }));
    const data = portfolio(holdings);
    const service = makeService([
      summaryCap(data),
      positionsCap(data.holdings),
      quoteCap(),
      calendarCap([{ symbol: 'AAA3.US', type: 'financial', date: (FIXED_NOW + DAY_MS) / 1000 }]),
    ]);

    const report = await service.analyze();

    expect(
      report.capabilityRuns.filter((run) => run.capabilityId === 'research.events' && run.status === 'success')
    ).toHaveLength(2);
    expect(report.signals.some((s) => s.kind === 'upcoming_earnings')).toBe(true);
  });

  it('applies drawdown thresholds (high >35%, medium >20%, none otherwise)', async () => {
    const data = portfolio([holding('AAA.US', { marketValue: 100 })]);
    const klineCap = (high: number, close: number) =>
      makeCap('market.kline', 'get_kline', klineSchema, (input) =>
        flatKlines(readSymbol(input), high, close)
      );

    const sharp = makeService([
      summaryCap(data),
      positionsCap(data.holdings),
      quoteCap(),
      klineCap(100, 60),
    ]);
    expect((await sharp.analyze()).signals.find((s) => s.kind === 'drawdown')?.severity).toBe('high');

    const moderate = makeService([
      summaryCap(data),
      positionsCap(data.holdings),
      quoteCap(),
      klineCap(100, 75),
    ]);
    expect((await moderate.analyze()).signals.find((s) => s.kind === 'drawdown')?.severity).toBe(
      'medium'
    );

    const healthy = makeService([
      summaryCap(data),
      positionsCap(data.holdings),
      quoteCap(),
      klineCap(100, 90),
    ]);
    expect((await healthy.analyze()).signals.some((s) => s.kind === 'drawdown')).toBe(false);
  });

  it('emits sector exposure only when profile data includes a sector', async () => {
    const data = portfolio([
      holding('AAA.US', { marketValue: 60 }),
      holding('BBB.US', { marketValue: 40 }),
    ]);

    const withSector = makeService([
      summaryCap(data),
      positionsCap(data.holdings),
      quoteCap(),
      makeCap('company.profile', 'get_company_profile', symbolSchema, (input) => {
        const symbol = readSymbol(input);
        return { symbol, name: symbol, sector: 'Technology' };
      }),
    ]);
    expect((await withSector.analyze()).signals.some((s) => s.kind === 'sector_exposure')).toBe(
      true
    );

    const noSector = makeService([
      summaryCap(data),
      positionsCap(data.holdings),
      quoteCap(),
      makeCap('company.profile', 'get_company_profile', symbolSchema, (input) => ({
        symbol: readSymbol(input),
        name: 'X',
      })),
    ]);
    expect((await noSector.analyze()).signals.some((s) => s.kind === 'sector_exposure')).toBe(false);
  });
});

describe('PortfolioRiskService synthesizer + failure isolation', () => {
  it('delegates the summary to the injected synthesizer', async () => {
    const data = portfolio([holding('AAA.US', { marketValue: 100 })]);
    let captured: PortfolioRiskSynthesisInput | undefined;
    const synthesizer: PortfolioRiskSynthesizer = async (input) => {
      captured = input;
      return 'agent summary';
    };

    const report = await makeService(
      [summaryCap(data), positionsCap(data.holdings), quoteCap()],
      synthesizer
    ).analyze();

    expect(report.summary).toBe('agent summary');
    expect(captured?.allocation).toHaveLength(1);
    expect(captured?.capabilityRuns.length).toBeGreaterThan(0);
    expect(captured?.signals.length).toBeGreaterThan(0);
  });

  it('isolates a failing capability and still produces a report', async () => {
    const data = portfolio([holding('AAA.US', { marketValue: 100 })]);
    const service = makeService([
      makeCap('portfolio.summary', 'get_portfolio', emptySchema, () => {
        throw new Error('summary boom');
      }),
      positionsCap(data.holdings),
      quoteCap(),
    ]);

    const report = await service.analyze();

    expect(report.allocation.map((a) => a.symbol)).toEqual(['AAA.US']);
    expect(
      report.capabilityRuns.some(
        (r) => r.capabilityId === 'portfolio.summary' && r.status === 'failed'
      )
    ).toBe(true);
  });

  it('produces an empty-but-valid report when no position data is available', async () => {
    const service = makeService([]);

    const report = await service.analyze();

    expect(report.allocation).toEqual([]);
    expect(report.concentration.top1Weight).toBe(0);
    expect(report.signals).toEqual([]);
    expect(report.summary).toContain('no position data');
    expect(
      report.capabilityRuns.some(
        (r) => r.capabilityId === 'portfolio.summary' && r.status === 'unavailable'
      )
    ).toBe(true);
  });
});
