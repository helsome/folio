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

    const within = makeService([
      summaryCap(data),
      positionsCap(data.holdings),
      quoteCap(),
      makeCap('research.events', 'get_calendar_events', emptySchema, () => ({
        events: [{ symbol: 'AAA.US', type: 'earnings', date: FIXED_NOW + 3 * DAY_MS }],
      })),
    ]);
    expect((await within.analyze()).signals.some((s) => s.kind === 'upcoming_earnings')).toBe(true);

    const outside = makeService([
      summaryCap(data),
      positionsCap(data.holdings),
      quoteCap(),
      makeCap('research.events', 'get_calendar_events', emptySchema, () => ({
        events: [{ symbol: 'AAA.US', type: 'earnings', date: FIXED_NOW + 30 * DAY_MS }],
      })),
    ]);
    expect((await outside.analyze()).signals.some((s) => s.kind === 'upcoming_earnings')).toBe(false);
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
