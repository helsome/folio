import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { installHappyDom } from '../test/setupHappyDom';
import { syncSelectedAgentContext } from './contextAtoms';

let restoreDom: (() => void) | undefined;
beforeAll(() => { restoreDom = installHappyDom().restore; });
afterAll(() => { restoreDom?.(); });
beforeEach(() => { delete (window as { electronAPI?: unknown }).electronAPI; });

describe('syncSelectedAgentContext', () => {
  it('returns only successfully persisted explicit selections', async () => {
    const calls: unknown[] = [];
    (window as { electronAPI?: unknown }).electronAPI = { context: { saveWatchlist: async (input: unknown) => { calls.push(input); return { ok: true, data: {} }; } } };
    const result = await syncSelectedAgentContext({ watchlist: true, portfolio: false }, ['NVDA.US'], null);
    expect(result).toEqual([{ kind: 'watchlist', id: 'default-watchlist' }]);
    expect(calls).toHaveLength(1);
  });

  it('surfaces IPC failure and never silently drops a checked context', async () => {
    (window as { electronAPI?: unknown }).electronAPI = { context: { saveWatchlist: async () => ({ ok: false, error: { message: 'Context store is locked.' } }) } };
    expect(syncSelectedAgentContext({ watchlist: true, portfolio: false }, ['NVDA.US'], null)).rejects.toThrow('Context store is locked.');
  });

  it('rejects a checked context when its source is empty or the channel is missing', async () => {
    (window as { electronAPI?: unknown }).electronAPI = { context: { saveWatchlist: async () => ({ ok: true, data: {} }) } };
    expect(syncSelectedAgentContext({ watchlist: true, portfolio: false }, [], null)).rejects.toThrow('watchlist is empty');
    delete (window as { electronAPI?: unknown }).electronAPI;
    expect(syncSelectedAgentContext({ watchlist: false, portfolio: true }, [], null)).rejects.toThrow('storage is unavailable');
  });
});
