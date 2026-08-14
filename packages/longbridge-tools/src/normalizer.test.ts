import { describe, expect, it } from 'bun:test';
import {
  classifyPortfolioFailure,
  computeUnrealizedPnLPercent,
  normalizePortfolioSnapshot,
  toFiniteNumber,
} from './normalizer.ts';
import { parsePortfolioResponse } from './parser.ts';
import { LongBridgeError } from './errors.ts';
import { loadFixture, loadFixtureText } from './testing/load-fixture.ts';
import type { Holding, PortfolioSnapshot } from '@finagent/core';

// ── UI-visible invariants (spec §15, §17) ─────────────────────────────────

function assertFiniteOrUndefined(value: unknown): void {
  if (value === undefined) return;
  expect(typeof value).toBe('number');
  expect(Number.isFinite(value)).toBe(true);
}

function assertHoldingInvariants(holding: Holding): void {
  expect(typeof holding.symbol).toBe('string');
  expect(typeof holding.name).toBe('string');
  assertFiniteOrUndefined(holding.quantity);
  assertFiniteOrUndefined(holding.availableQuantity);
  assertFiniteOrUndefined(holding.costPrice);
  assertFiniteOrUndefined(holding.marketPrice);
  assertFiniteOrUndefined(holding.marketValue);
  assertFiniteOrUndefined(holding.marketValueBase);
  assertFiniteOrUndefined(holding.unrealizedPnL);
  assertFiniteOrUndefined(holding.unrealizedPnLPercent);
  assertFiniteOrUndefined(holding.prevClose);
}

function assertSnapshotInvariants(snapshot: PortfolioSnapshot): void {
  assertFiniteOrUndefined(snapshot.totalAssets);
  assertFiniteOrUndefined(snapshot.marketValue);
  assertFiniteOrUndefined(snapshot.cash);
  assertFiniteOrUndefined(snapshot.totalPnL);
  assertFiniteOrUndefined(snapshot.todayPnL);
  for (const account of snapshot.accounts) {
    expect(typeof account.id).toBe('string');
    assertFiniteOrUndefined(account.netAssets);
    assertFiniteOrUndefined(account.marketValue);
    assertFiniteOrUndefined(account.cash);
    assertFiniteOrUndefined(account.pnl);
    assertFiniteOrUndefined(account.todayPnL);
  }
  for (const holding of snapshot.holdings) assertHoldingInvariants(holding);
}

describe('toFiniteNumber', () => {
  it('coerces numeric strings, numbers, and degrades non-numerics to undefined', () => {
    expect(toFiniteNumber('123.45')).toBe(123.45);
    expect(toFiniteNumber(123)).toBe(123);
    expect(toFiniteNumber('')).toBeUndefined();
    expect(toFiniteNumber(null)).toBeUndefined();
    expect(toFiniteNumber(undefined)).toBeUndefined();
    expect(toFiniteNumber('not-a-number')).toBeUndefined();
    expect(toFiniteNumber(Number.NaN)).toBeUndefined();
  });
});

describe('computeUnrealizedPnLPercent', () => {
  it('computes gain/loss percent and returns undefined when cost is missing or zero', () => {
    expect(computeUnrealizedPnLPercent(100, 120)).toBeCloseTo(20);
    expect(computeUnrealizedPnLPercent(120, 100)).toBeCloseTo(-16.6666, 3);
    expect(computeUnrealizedPnLPercent(0, 100)).toBeUndefined();
    expect(computeUnrealizedPnLPercent(undefined, 100)).toBeUndefined();
    expect(computeUnrealizedPnLPercent(100, undefined)).toBeUndefined();
  });
});

describe('normalizePortfolioSnapshot fixture matrix (spec §59)', () => {
  it('parses the committed hand-annotated multi-currency sample with no corrupt values', () => {
    const snapshot = normalizePortfolioSnapshot(loadFixture('portfolio.sample'), 1000);
    expect(snapshot.baseCurrency).toBe('USD');
    expect(snapshot.totalAssets).toBe(50000);
    expect(snapshot.marketValue).toBe(42000);
    expect(snapshot.cash).toBe(8000);
    expect(snapshot.totalPnL).toBe(1250.5);
    expect(snapshot.todayPnL).toBe(-320.1);
    expect(snapshot.accounts.map((a) => a.id)).toEqual(['HK', 'US']);
    expect(snapshot.accounts.map((a) => a.currency)).toEqual(['HKD', 'USD']);
    expect(snapshot.holdings).toHaveLength(4);
    assertSnapshotInvariants(snapshot);
  });

  it('passes unicode names through unbroken', () => {
    const snapshot = normalizePortfolioSnapshot(loadFixture('portfolio.sample'), 1000);
    const hk = snapshot.holdings.find((h) => h.symbol === '0700.HK');
    expect(hk?.name).toBe('腾讯控股');
  });

  it('carries per-holding and per-account currency', () => {
    const snapshot = normalizePortfolioSnapshot(loadFixture('portfolio.sample'), 1000);
    expect(snapshot.holdings.find((h) => h.symbol === '0700.HK')?.currency).toBe('HKD');
    expect(snapshot.holdings.find((h) => h.symbol === 'AAPL.US')?.currency).toBe('USD');
  });

  it('computes unrealized PnL from cost/market when the vendor omits it', () => {
    const snapshot = normalizePortfolioSnapshot(loadFixture('portfolio.sample'), 1000);
    const aapl = snapshot.holdings.find((h) => h.symbol === 'AAPL.US');
    // (200 − 180) × 10 = 200
    expect(aapl?.unrealizedPnL).toBeCloseTo(200);
    expect(aapl?.unrealizedPnLPercent).toBeCloseTo(11.1111, 3);
  });

  it('produces negative PnL for a losing position', () => {
    const snapshot = normalizePortfolioSnapshot(loadFixture('portfolio.sample'), 1000);
    const baba = snapshot.holdings.find((h) => h.symbol === 'BABA.US');
    // (100 − 120) × 20 = −400
    expect(baba?.unrealizedPnL).toBeCloseTo(-400);
    expect(baba?.unrealizedPnLPercent).toBeLessThan(0);
  });

  it('leaves market value/pnl undefined for a null last price', () => {
    const snapshot = normalizePortfolioSnapshot(loadFixture('portfolio.sample'), 1000);
    const delisted = snapshot.holdings.find((h) => h.symbol === 'DELISTED.US');
    expect(delisted?.marketPrice).toBeUndefined();
    expect(delisted?.unrealizedPnL).toBeUndefined();
    expect(delisted?.unrealizedPnLPercent).toBeUndefined();
  });

  it('handles numeric (non-string) overview and holding values', () => {
    const snapshot = normalizePortfolioSnapshot({
      overview: { total_asset: 1000, market_cap: 900, total_cash: 100, currency: 'USD' },
      market_accounts: {
        US: { market: 'US', currency: 'USD', net_assets: 1000, market_value: 900, balance: 100 },
      },
      holdings: [
        { symbol: 'AAPL.US', name: 'Apple', currency: 'USD', quantity: 2, cost_price: 100, market_price: 150, market_value: 300 },
      ],
    }, 1000);
    expect(snapshot.totalAssets).toBe(1000);
    expect(snapshot.holdings[0].quantity).toBe(2);
    expect(snapshot.holdings[0].marketValue).toBe(300);
    assertSnapshotInvariants(snapshot);
  });

  it('returns an empty-but-valid snapshot for an empty portfolio', () => {
    const snapshot = normalizePortfolioSnapshot({
      overview: { total_asset: '0', market_cap: '0', total_cash: '0', currency: 'USD' },
      market_accounts: {},
      holdings: [],
    }, 1000);
    expect(snapshot.totalAssets).toBe(0);
    expect(snapshot.accounts).toEqual([]);
    expect(snapshot.holdings).toEqual([]);
    assertSnapshotInvariants(snapshot);
  });

  it('degrades a malformed holding (missing symbol) without NaN or throw', () => {
    const snapshot = normalizePortfolioSnapshot({
      overview: { total_asset: '100', currency: 'USD' },
      holdings: [{ name: 'No Symbol', quantity: '5', cost_price: 'abc', market_price: '20' }],
    }, 1000);
    expect(snapshot.holdings).toHaveLength(0);
    assertSnapshotInvariants(snapshot);
  });
});

describe('real CLI fixture', () => {
  it('maps the real `longbridge portfolio --format json` body (totals + holdings + base USD)', () => {
    const raw = JSON.parse(loadFixtureText('portfolio'));
    const snapshot = normalizePortfolioSnapshot(raw, 1000);
    expect(snapshot.baseCurrency).toBe('USD');
    expect(typeof snapshot.totalAssets).toBe('number');
    expect(snapshot.holdings.length).toBeGreaterThan(0);
    expect(snapshot.accounts.length).toBeGreaterThanOrEqual(2);
    assertSnapshotInvariants(snapshot);
  });
});

describe('parsePortfolioResponse error taxonomy (spec §19)', () => {
  it('throws a user-safe parse error without embedding raw output', () => {
    const raw = 'NOT-JSON{{{';
    try {
      parsePortfolioResponse(raw);
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(LongBridgeError);
      const lbError = error as LongBridgeError;
      expect(lbError.code).toBe('LONGBRIDGE_PARSE_FAILURE');
      expect(lbError.message).not.toContain('NOT-JSON');
      expect(lbError.debug).toContain('NOT-JSON');
    }
  });

  it('throws parse-error for a non-object top-level value', () => {
    expect(() => parsePortfolioResponse('[]')).toThrow(LongBridgeError);
  });

  it('classifies each LongBridge error code into the matching failure kind', () => {
    expect(classifyPortfolioFailure(new LongBridgeError('x', 'LONGBRIDGE_NOT_INSTALLED')).kind).toBe('not-connected');
    expect(classifyPortfolioFailure(new LongBridgeError('x', 'LONGBRIDGE_NOT_AUTHED')).kind).toBe('no-account-permission');
    expect(classifyPortfolioFailure(new LongBridgeError('x', 'LONGBRIDGE_TIMEOUT')).kind).toBe('timeout');
    expect(classifyPortfolioFailure(new LongBridgeError('x', 'LONGBRIDGE_PARSE_FAILURE')).kind).toBe('parse-error');
    expect(classifyPortfolioFailure(new LongBridgeError('x', 'LONGBRIDGE_UNKNOWN')).kind).toBe('provider-error');
    expect(classifyPortfolioFailure(new Error('boom')).kind).toBe('provider-error');
  });
});
