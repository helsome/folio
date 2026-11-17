import { describe, expect, it } from 'bun:test';
import { createStore } from 'jotai';
import type { PortfolioSnapshot } from '@finagent/core';
import { fallbackClient, type FinagentClient } from '../client';
import { fetchPortfolioAtom, portfolioCacheAtom, portfolioViewAtom } from './portfolioAtoms';

const SNAPSHOT: PortfolioSnapshot = {
  accounts: [],
  holdings: [{ symbol: 'AAPL.US', name: 'Apple', marketValue: 100 }],
  totalAssets: 100,
  fetchedAt: 1,
};

function clientWith(getPortfolio: FinagentClient['market']['getPortfolio']): FinagentClient {
  return { ...fallbackClient, market: { ...fallbackClient.market, getPortfolio } };
}

describe('fetchPortfolioAtom failure policy', () => {
  it.each([
    ['LONGBRIDGE_PARSE_FAILURE', 'parse-error'],
    ['LONGBRIDGE_TIMEOUT', 'timeout'],
    ['PARSE_FAILURE', 'parse-error'],
    ['TIMEOUT', 'timeout'],
    ['PROVIDER_UNAVAILABLE', 'provider-error'],
  ] as const)('keeps %s visible instead of replacing it with sample holdings', async (code, kind) => {
    const store = createStore();
    const client = clientWith(async () => ({ ok: false, error: { code, message: 'Request failed' } }));

    expect(await store.set(fetchPortfolioAtom, client)).toBeNull();
    expect(store.get(portfolioCacheAtom)).toMatchObject({
      data: null, failure: { kind }, isDemo: false, loading: false, timestamp: 0,
    });
    expect(store.get(portfolioViewAtom)).toBeNull();
  });

  it.each([
    ['LONGBRIDGE_NOT_INSTALLED', 'not-connected'],
    ['LONGBRIDGE_NOT_AUTHED', 'no-account-permission'],
    ['AUTH_EXPIRED', 'no-account-permission'],
  ] as const)('retains the badged sample fallback and classification for %s', async (code, kind) => {
    const store = createStore();
    await store.set(fetchPortfolioAtom, clientWith(async () => ({
      ok: false, error: { code, message: 'Connection unavailable' },
    })));

    const cache = store.get(portfolioCacheAtom);
    expect(cache).toMatchObject({ failure: { kind }, isDemo: true, loading: false });
    expect(cache.data?.holdings.length).toBeGreaterThan(0);
  });

  it('classifies rejected IPC calls without leaking an unhandled rejection to TodayView', async () => {
    const store = createStore();
    const client = clientWith(async () => { throw new Error('IPC disconnected'); });

    expect(await store.set(fetchPortfolioAtom, client)).toBeNull();
    expect(store.get(portfolioCacheAtom)).toMatchObject({
      data: null, failure: { kind: 'provider-error', message: 'IPC disconnected' },
      error: 'IPC disconnected', isDemo: false, loading: false,
    });
  });

  it('preserves a machine code carried by a rejected IPC call', async () => {
    const store = createStore();
    await store.set(fetchPortfolioAtom, clientWith(async () => {
      throw { code: 'LONGBRIDGE_PARSE_FAILURE', message: 'raw vendor {{{' };
    }));
    const cache = store.get(portfolioCacheAtom);
    expect(cache.failure?.kind).toBe('parse-error');
    expect(cache.error).not.toContain('raw vendor');
    expect(cache.isDemo).toBe(false);
  });

  it('clears a previously loaded snapshot on failure and recovers on the next successful fetch', async () => {
    const store = createStore();
    const healthy = clientWith(async () => ({ ok: true, data: SNAPSHOT }));
    await store.set(fetchPortfolioAtom, healthy);
    await store.set(fetchPortfolioAtom, clientWith(async () => ({
      ok: false, error: { code: 'LONGBRIDGE_TIMEOUT', message: 'Timeout' },
    })));
    expect(store.get(portfolioViewAtom)).toBeNull();
    expect(store.get(portfolioCacheAtom).failure?.kind).toBe('timeout');

    expect(await store.set(fetchPortfolioAtom, healthy)).toBe(SNAPSHOT);
    expect(store.get(portfolioCacheAtom)).toMatchObject({
      data: SNAPSHOT, failure: null, error: null, isDemo: false, loading: false,
    });
  });

  it('keeps a partial real snapshot and its failure classification', async () => {
    const store = createStore();
    const partial = { ...SNAPSHOT, holdings: [] };
    expect(await store.set(fetchPortfolioAtom, clientWith(async () => ({ ok: true, data: partial })))).toBe(partial);
    expect(store.get(portfolioCacheAtom)).toMatchObject({
      data: partial, failure: { kind: 'partial' }, isDemo: false, error: null,
    });
  });

  it('keeps the existing sample fallback for a connected empty account', async () => {
    const store = createStore();
    await store.set(fetchPortfolioAtom, clientWith(async () => ({
      ok: true, data: { ...SNAPSHOT, totalAssets: 0, holdings: [] },
    })));
    expect(store.get(portfolioCacheAtom)).toMatchObject({ isDemo: true, failure: null, error: null });
    expect(store.get(portfolioCacheAtom).data?.holdings.length).toBeGreaterThan(0);
  });
});
