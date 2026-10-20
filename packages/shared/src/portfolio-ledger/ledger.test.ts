import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { PortfolioLedgerEntry } from '@finagent/core';
import { JsonFileStore } from '../storage/json-file-store.ts';
import { PortfolioLedgerRepository } from './repository.ts';
import { classifyCashFlow, cashFlowToLedgerEntries, snapshotToValuationEntry } from './service.ts';
import { computeTwr, TWR_COMPUTATION_VERSION } from './twr.ts';

let dir = '';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'finagent-ledger-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const PORTFOLIO = 'pf-1';

function repository(): PortfolioLedgerRepository {
  return new PortfolioLedgerRepository(new JsonFileStore(dir));
}

let seq = 0;

/** Build an entry input with a unique stable identity per call. */
function entry(overrides: Partial<PortfolioLedgerEntry> & { kind: PortfolioLedgerEntry['kind'] }): Omit<PortfolioLedgerEntry, 'id'> {
  seq += 1;
  return {
    portfolioId: overrides.portfolioId ?? PORTFOLIO,
    kind: overrides.kind,
    occurredAt: overrides.occurredAt ?? 1_700_000_000_000 + seq * 1_000,
    ...(overrides.direction !== undefined ? { direction: overrides.direction } : {}),
    ...(overrides.currency !== undefined ? { currency: overrides.currency } : {}),
    ...(overrides.amount !== undefined ? { amount: overrides.amount } : {}),
    ...(overrides.fxRateToBase !== undefined ? { fxRateToBase: overrides.fxRateToBase } : {}),
    ...(overrides.totalValue !== undefined ? { totalValue: overrides.totalValue } : {}),
    ...(overrides.cashBalance !== undefined ? { cashBalance: overrides.cashBalance } : {}),
    ...(overrides.positions !== undefined ? { positions: overrides.positions } : {}),
    source: overrides.source ?? { provider: 'test', kind: 'test', externalId: `e${seq}` },
    ...(overrides.note !== undefined ? { note: overrides.note } : {}),
  };
}

describe('PortfolioLedgerRepository import idempotency (#335 A)', () => {
  it('appends once, skips identical re-imports, and does not bump revision', async () => {
    const repo = repository();
    const batch = [
      entry({ kind: 'valuation', totalValue: 100 }),
      entry({ kind: 'external-flow', direction: 'in', currency: 'USD', amount: 100 }),
    ];
    const first = await repo.appendBatch(PORTFOLIO, batch);
    expect(first).toMatchObject({ added: 2, corrected: 0, skipped: 0, ledgerRevision: 1 });

    // Re-running the SAME batch must not double-count (#335: 导入重跑不重复记账).
    const second = await repo.appendBatch(PORTFOLIO, batch);
    expect(second).toMatchObject({ added: 0, corrected: 0, skipped: 2, ledgerRevision: 1 });

    const ledger = await repo.get(PORTFOLIO);
    expect(ledger?.entries).toHaveLength(2);
    expect(ledger?.revision).toBe(1);
  });

  it('keeps the prior version when a correction changes content', async () => {
    const repo = repository();
    const original = entry({ kind: 'valuation', totalValue: 100 });
    await repo.appendBatch(PORTFOLIO, [original]);

    const corrected = { ...original, totalValue: 105 };
    const result = await repo.appendBatch(PORTFOLIO, [corrected]);
    expect(result).toMatchObject({ added: 0, corrected: 1, ledgerRevision: 2 });

    const ledger = await repo.get(PORTFOLIO);
    expect(ledger?.entries).toHaveLength(1);
    expect(ledger?.entries[0].totalValue).toBe(105);
    // The prior version survives in history (#335: 修正保留版本).
    expect(ledger?.history[ledger.entries[0].id]).toHaveLength(1);
    expect(ledger?.history[ledger.entries[0].id][0].totalValue).toBe(100);
  });

  it('isolates portfolios and rejects cross-portfolio batches', async () => {
    const repo = repository();
    await repo.appendBatch('pf-a', [entry({ kind: 'valuation', totalValue: 1, portfolioId: 'pf-a' })]);
    await expect(
      repo.appendBatch('pf-b', [entry({ kind: 'valuation', totalValue: 2, portfolioId: 'pf-a' })])
    ).rejects.toThrow(/belongs to portfolio/);
    expect(await repo.get('pf-b')).toBeUndefined();
  });

  it('persists across repository instances (restart persistence)', async () => {
    const repo = repository();
    await repo.appendBatch(PORTFOLIO, [entry({ kind: 'valuation', totalValue: 100 })]);
    const reopened = new PortfolioLedgerRepository(new JsonFileStore(dir));
    expect((await reopened.get(PORTFOLIO))?.entries).toHaveLength(1);
  });
});

describe('computeTwr golden samples (#335 B)', () => {
  it('simple growth: deposit 100 then NAV 110 → +10%', () => {
    const result = computeTwr([
      entry({ kind: 'valuation', totalValue: 100, occurredAt: 1_700_000_000_000 }),
      entry({ kind: 'valuation', totalValue: 110, occurredAt: 1_700_000_086_400_000 }),
    ]);
    expect(result.status).toBe('ok');
    expect(result.returnPct).toBeCloseTo(10, 10);
    expect(result.periods).toHaveLength(1);
    expect(result.computation.version).toBe(TWR_COMPUTATION_VERSION);
  });

  it('begin-of-interval deposit: +10% then deposit 90 and −5% day → chain +4.5%', () => {
    const result = computeTwr([
      entry({ kind: 'valuation', totalValue: 100, occurredAt: 0 }),
      entry({ kind: 'valuation', totalValue: 110, occurredAt: 86_400_000 }),
      // Day 2 begins with a 90 deposit: base 200, ends at 190 → −5%.
      entry({ kind: 'external-flow', direction: 'in', currency: 'USD', amount: 90, occurredAt: 86_400_000 + 1 }),
      entry({ kind: 'valuation', totalValue: 190, occurredAt: 2 * 86_400_000 }),
    ]);
    expect(result.status).toBe('ok');
    expect(result.periods?.[0].returnPct).toBeCloseTo(10, 10);
    expect(result.periods?.[1].returnPct).toBeCloseTo(-5, 10);
    expect(result.periods?.[1].externalFlowBase).toBe(90);
    expect(result.returnPct).toBeCloseTo((1.1 * 0.95 - 1) * 100, 10);
  });

  it('begin-of-interval withdrawal: base 140 ending 154 → +10%, chain 1.1×0.95×1.1', () => {
    const result = computeTwr([
      entry({ kind: 'valuation', totalValue: 100, occurredAt: 0 }),
      entry({ kind: 'valuation', totalValue: 110, occurredAt: 86_400_000 }),
      entry({ kind: 'external-flow', direction: 'in', currency: 'USD', amount: 90, occurredAt: 86_400_000 + 1 }),
      entry({ kind: 'valuation', totalValue: 190, occurredAt: 2 * 86_400_000 }),
      entry({ kind: 'external-flow', direction: 'out', currency: 'USD', amount: 50, occurredAt: 2 * 86_400_000 + 1 }),
      entry({ kind: 'valuation', totalValue: 154, occurredAt: 3 * 86_400_000 }),
    ]);
    expect(result.status).toBe('ok');
    expect(result.periods?.[2].returnPct).toBeCloseTo(10, 10);
    // Independent chained computation: 1.1 × 0.95 × 1.1 − 1 = 14.95%.
    expect(result.returnPct).toBeCloseTo((1.1 * 0.95 * 1.1 - 1) * 100, 10);
  });

  it('deposits never manufacture returns; withdrawals never hide them', () => {
    // 100 deposited, then another 100 deposited and NAV still 200: return 0%.
    const result = computeTwr([
      entry({ kind: 'valuation', totalValue: 100, occurredAt: 0 }),
      entry({ kind: 'external-flow', direction: 'in', currency: 'USD', amount: 100, occurredAt: 1 }),
      entry({ kind: 'valuation', totalValue: 200, occurredAt: 86_400_000 }),
    ]);
    expect(result.status).toBe('ok');
    expect(result.returnPct).toBeCloseTo(0, 10);
  });

  it('dividends and fees stay INSIDE the return (internal flows)', () => {
    // NAV 100 → dividend 5 credited → NAV 105: +5% investment return, the
    // dividend is not neutralized.
    const result = computeTwr([
      entry({ kind: 'valuation', totalValue: 100, occurredAt: 0 }),
      entry({ kind: 'dividend', currency: 'USD', amount: 5, direction: 'in', occurredAt: 1 }),
      entry({ kind: 'valuation', totalValue: 105, occurredAt: 86_400_000 }),
    ]);
    expect(result.status).toBe('ok');
    expect(result.returnPct).toBeCloseTo(5, 10);
  });

  it('cross-currency flows convert by the imported fxRateToBase', () => {
    // 100 HKD deposited at 0.8 → base flow 80; base 180 ends at 198: +10%.
    const result = computeTwr([
      entry({ kind: 'valuation', totalValue: 100, occurredAt: 0 }),
      entry({
        kind: 'external-flow', direction: 'in', currency: 'HKD', amount: 100, fxRateToBase: 0.8, occurredAt: 1,
      }),
      entry({ kind: 'valuation', totalValue: 198, occurredAt: 86_400_000 }),
    ]);
    expect(result.status).toBe('ok');
    expect(result.periods?.[0].externalFlowBase).toBeCloseTo(80, 10);
    expect(result.returnPct).toBeCloseTo(10, 10);
  });

  it('withdrawal larger than the base → explicit non-positive-denominator', () => {
    const result = computeTwr([
      entry({ kind: 'valuation', totalValue: 100, occurredAt: 0 }),
      entry({ kind: 'external-flow', direction: 'out', currency: 'USD', amount: 150, occurredAt: 1 }),
      entry({ kind: 'valuation', totalValue: 10, occurredAt: 86_400_000 }),
    ]);
    expect(result).toMatchObject({ status: 'unavailable', unavailableReason: 'non-positive-denominator' });
  });

  it('non-positive NAV → unavailable', () => {
    const result = computeTwr([
      entry({ kind: 'valuation', totalValue: 100, occurredAt: 0 }),
      entry({ kind: 'valuation', totalValue: 0, occurredAt: 86_400_000 }),
    ]);
    expect(result).toMatchObject({ status: 'unavailable', unavailableReason: 'non-positive-nav' });
  });

  it('valuation missing totalValue → unavailable (never inferred)', () => {
    const result = computeTwr([
      entry({ kind: 'valuation', totalValue: 100, occurredAt: 0 }),
      entry({ kind: 'valuation', occurredAt: 86_400_000 }),
    ]);
    expect(result).toMatchObject({ status: 'unavailable', unavailableReason: 'non-positive-nav' });
  });

  it('external flow outside valuation coverage → unavailable, never ignored', () => {
    const result = computeTwr([
      entry({ kind: 'valuation', totalValue: 100, occurredAt: 86_400_000 }),
      entry({ kind: 'valuation', totalValue: 110, occurredAt: 2 * 86_400_000 }),
      entry({ kind: 'external-flow', direction: 'in', currency: 'USD', amount: 10, occurredAt: 0 }),
    ]);
    expect(result).toMatchObject({ status: 'unavailable', unavailableReason: 'flows-outside-coverage' });
  });

  it('fewer than two valuations → unavailable', () => {
    expect(
      computeTwr([entry({ kind: 'valuation', totalValue: 100, occurredAt: 0 })])
    ).toMatchObject({ status: 'unavailable', unavailableReason: 'insufficient-valuations' });
    expect(computeTwr([])).toMatchObject({ status: 'unavailable', unavailableReason: 'no-entries' });
  });
});

describe('deterministic classification and snapshot mapping (#335 A)', () => {
  it('classifies vendor cash flows without any model', () => {
    expect(classifyCashFlow({ businessType: 'deposit' })).toMatchObject({ kind: 'external-flow', direction: 'in' });
    expect(classifyCashFlow({ flowName: 'Withdrawal' })).toMatchObject({ kind: 'external-flow', direction: 'out' });
    expect(classifyCashFlow({ flowName: 'Dividend AAPL' })).toMatchObject({ kind: 'dividend' });
    expect(classifyCashFlow({ businessType: 'trade-fee' })).toMatchObject({ kind: 'fee' });
    // Unrecognized → internal trade, NEVER an external flow.
    expect(classifyCashFlow({ businessType: 'something-else' })).toMatchObject({ kind: 'trade' });
  });

  it('maps cash-flow records to stable, re-import-safe entries', () => {
    const records = [
      { timestamp: 1_700_000_000, currency: 'HKD', amount: 500, businessType: 'deposit' },
      { timestamp: 1_700_008_640, currency: 'HKD', amount: -20, businessType: 'trade-fee' },
    ];
    const entries = cashFlowToLedgerEntries(PORTFOLIO, records);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ kind: 'external-flow', direction: 'in', amount: 500 });
    expect(entries[1]).toMatchObject({ kind: 'fee', direction: 'out', amount: 20 });
    // Same record → same identity → same id (idempotency foundation).
    expect(entries[0].source.externalId).toBe(cashFlowToLedgerEntries(PORTFOLIO, records)[0].source.externalId);
  });

  it('maps a snapshot into a valuation entry without inventing data', async () => {
    const repo = repository();
    const input = snapshotToValuationEntry(
      PORTFOLIO,
      {
        baseCurrency: 'USD',
        totalAssets: 200,
        cash: 50,
        accounts: [],
        holdings: [{ symbol: 'AAPL.US', name: 'Apple', quantity: 2, marketValue: 150, currency: 'USD' }],
        fetchedAt: 1_700_000_000_000,
      },
      { provider: 'test' }
    );
    await repo.appendBatch(PORTFOLIO, [input]);
    const ledger = await repo.get(PORTFOLIO);
    expect(ledger?.entries[0]).toMatchObject({
      kind: 'valuation',
      totalValue: 200,
      cashBalance: 50,
      currency: 'USD',
    });
    expect(ledger?.entries[0].positions).toEqual([
      { symbol: 'AAPL.US', quantity: 2, marketValue: 150, currency: 'USD' },
    ]);
    // Re-importing the same snapshot is a no-op.
    const again = await repo.appendBatch(PORTFOLIO, [input]);
    expect(again).toMatchObject({ added: 0, corrected: 0, skipped: 1 });
  });

  it('keeps the revision monotonic across restarts for identical re-imports', async () => {
    const repo = repository();
    const batch = [entry({ kind: 'valuation', totalValue: 100, occurredAt: 0 })];
    await repo.appendBatch(PORTFOLIO, batch);
    const raw = JSON.parse(await readFile(join(dir, 'portfolio-ledger.json'), 'utf8'));
    expect(Object.keys(raw.ledgers)).toContain(PORTFOLIO);
    const before = raw.ledgers[PORTFOLIO].revision;
    // A fresh instance re-importing the identical batch must not bump revision.
    const fresh = new PortfolioLedgerRepository(new JsonFileStore(dir));
    const after = await fresh.appendBatch(PORTFOLIO, batch);
    expect(after).toMatchObject({ added: 0, corrected: 0, skipped: 1, ledgerRevision: before });
  });

  it('coverage summarizes kinds and bounds', async () => {
    const repo = repository();
    await repo.appendBatch(PORTFOLIO, [
      entry({ kind: 'valuation', totalValue: 100, occurredAt: 1_700_000_000_000 }),
      entry({ kind: 'valuation', totalValue: 110, occurredAt: 1_700_008_640_000 }),
      entry({ kind: 'external-flow', direction: 'in', currency: 'USD', amount: 10, occurredAt: 1_700_004_320_000 }),
    ]);
    const coverage = await repo.coverage(PORTFOLIO);
    expect(coverage).toMatchObject({
      portfolioId: PORTFOLIO,
      firstEntryAt: 1_700_000_000_000,
      lastEntryAt: 1_700_008_640_000,
      revision: 1,
    });
    expect(coverage.counts).toMatchObject({ valuation: 2, 'external-flow': 1 });
  });
});
