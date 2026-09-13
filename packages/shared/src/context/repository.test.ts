import { describe, expect, it } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonFileStore } from '../storage/json-file-store.ts';
import { PortfolioContextRepository } from './repository.ts';

async function repository(now = 1_800_000_000_000) {
  const dir = await mkdtemp(join(tmpdir(), 'folio-context-'));
  return { dir, repo: new PortfolioContextRepository(new JsonFileStore(dir), () => now) };
}

describe('PortfolioContextRepository', () => {
  it('persists structured watchlists and portfolios with canonical ids and versions', async () => {
    const { dir, repo } = await repository();
    const instruments = ['AAPL.US', 'MSFT.US', 'NVDA.US', '0700.HK', 'D05.SG'];
    const watchlist = await repo.saveWatchlist({ id: 'wl-main', name: 'AI leaders', instruments: instruments.map((instrumentId) => ({ instrumentId })) });
    const portfolio = await repo.savePortfolio({ id: 'pf-main', name: 'Core', asOf: 1_799_000_000_000, positions: instruments.map((instrumentId) => ({ instrumentId, quantity: 10, nativeCurrency: instrumentId.endsWith('.HK') ? 'HKD' : 'USD' })) });
    expect(watchlist.version).toBe(1);
    expect(portfolio.positions).toHaveLength(5);
    const restarted = new PortfolioContextRepository(new JsonFileStore(dir));
    expect((await restarted.listWatchlists())[0]?.instruments).toHaveLength(5);
  });

  it('freezes a minimal run snapshot and does not rewrite history after edits', async () => {
    const { repo } = await repository();
    await repo.savePortfolio({ id: 'pf', name: 'Core', asOf: 100, positions: [
      { instrumentId: 'AAPL.US', quantity: 10, nativeCurrency: 'USD' },
      { instrumentId: 'MSFT.US', quantity: 20, nativeCurrency: 'USD' },
    ] });
    const first = await repo.bindRun({ runId: 'run-1', sessionId: 'session-1', branchId: 'main', selections: [{ kind: 'portfolio', id: 'pf' }], relevantInstrumentIds: ['AAPL.US'] });
    await repo.savePortfolio({ id: 'pf', name: 'Core', asOf: 200, positions: [{ instrumentId: 'AAPL.US', quantity: 99, nativeCurrency: 'USD' }] });
    const historical = await repo.getRunContext('run-1', 'session-1', 'main');
    expect(first.snapshots[0]?.sourceVersion).toBe(1);
    expect((historical?.snapshots[0]?.document as { positions: Array<{ instrumentId: string; quantity?: number; nativeCurrency: string }> }).positions).toEqual([{ instrumentId: 'AAPL.US', quantity: 10, nativeCurrency: 'USD' }]);
    expect((await repo.listPortfolios())[0]?.version).toBe(2);
  });

  it('does not leak a binding across conversations or branches', async () => {
    const { repo } = await repository();
    await repo.saveWatchlist({ id: 'wl', name: 'Private', instruments: [{ instrumentId: 'NVDA.US' }] });
    await repo.bindRun({ runId: 'run-private', sessionId: 'session-a', branchId: 'branch-a', selections: [{ kind: 'watchlist', id: 'wl' }] });
    expect(await repo.getRunContext('run-private', 'session-b', 'branch-a')).toBeUndefined();
    expect(await repo.getRunContext('run-private', 'session-a', 'branch-b')).toBeUndefined();
    expect(await repo.getRunContext('run-private', 'session-a', 'branch-a')).toBeDefined();
  });

  it('rejects bare ticker strings', async () => {
    const { repo } = await repository();
    expect(repo.saveWatchlist({ id: 'wl', name: 'Bad', instruments: [{ instrumentId: 'AAPL' }] })).rejects.toThrow('Invalid canonical instrument id');
  });

  it('fails clearly when an explicitly selected context does not exist', async () => {
    const { repo } = await repository();
    expect(repo.snapshot({ kind: 'watchlist', id: 'missing' })).rejects.toThrow('watchlist context not found');
    expect(await repo.get({ kind: 'portfolio', id: 'missing' })).toBeUndefined();
  });

  it('binds an existing frozen snapshot without copying unrelated context', async () => {
    const { repo } = await repository();
    await repo.saveWatchlist({ id: 'wl', name: 'Focused', instruments: [{ instrumentId: 'AAPL.US' }, { instrumentId: 'MSFT.US' }] });
    const snapshot = await repo.snapshot({ kind: 'watchlist', id: 'wl' }, ['MSFT.US']);
    await repo.bindSnapshots({ runId: 'run-frozen', sessionId: 'session-a', branchId: 'main', snapshots: [snapshot] });
    const result = await repo.getRunContext('run-frozen', 'session-a', 'main');
    expect((result?.snapshots[0]?.document as { instruments: Array<{ instrumentId: string }> }).instruments).toEqual([{ instrumentId: 'MSFT.US' }]);
  });

  it('gives same-millisecond snapshots unique durable ids', async () => {
    const { repo } = await repository();
    await repo.saveWatchlist({ id: 'wl', name: 'Focused', instruments: [{ instrumentId: 'AAPL.US' }] });
    const [first, second] = await Promise.all([
      repo.snapshot({ kind: 'watchlist', id: 'wl' }),
      repo.snapshot({ kind: 'watchlist', id: 'wl' }),
    ]);
    expect(first.id).not.toBe(second.id);
  });

  it('serializes concurrent edits so versions are monotonic and no update is lost', async () => {
    const { repo } = await repository();
    await Promise.all([
      repo.saveWatchlist({ id: 'wl', name: 'One', instruments: [{ instrumentId: 'AAPL.US' }] }),
      repo.saveWatchlist({ id: 'wl', name: 'Two', instruments: [{ instrumentId: 'MSFT.US' }] }),
    ]);
    const saved = (await repo.listWatchlists())[0];
    expect(saved?.version).toBe(2);
    expect(['One', 'Two']).toContain(saved?.name);
  });
});
