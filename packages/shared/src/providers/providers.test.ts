import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type {
  AccountAssets,
  BrokerAccount,
  BrokerAccountProvider,
  CapabilityId,
  CashFlowRecord,
  FinancialDataProvider,
  Holding,
  PortfolioSnapshot,
  ProviderHealth,
  ProviderResult,
} from '@finagent/core';
import { JsonFileStore } from '../storage/json-file-store.ts';
import { ConnectionStore } from './connection.ts';
import { BROKER_CAPABILITY_IDS, capabilityMapping } from './coverage.ts';
import { healthAll } from './health.ts';
import { ProviderRegistry } from './registry.ts';
import { ProviderFetchError, createRouterFetchers } from './router-fetchers.ts';
import { ProviderRouter } from './router.ts';

type Handler = (
  capabilityId: CapabilityId,
  input: unknown,
  signal?: AbortSignal
) => Promise<ProviderResult<unknown>>;

function success<T>(providerId: string, providerName: string, data: T): ProviderResult<T> {
  return {
    ok: true,
    data,
    provenance: { providerId, providerName, fetchedAt: 1000, stale: false },
  };
}

function failure(code: string, message = 'provider failure'): ProviderResult<never> {
  return { ok: false, error: { code, message } };
}

class FakeFinancialDataProvider implements FinancialDataProvider {
  kind = 'financial-data' as const;

  constructor(
    readonly id: string,
    readonly name: string,
    private readonly caps: CapabilityId[],
    private readonly handler: Handler = async () => success(this.id, this.name, undefined)
  ) {}

  async status(): Promise<ProviderHealth> {
    return { status: 'connected', lastCheck: 1234 };
  }

  capabilities(): CapabilityId[] {
    return [...this.caps];
  }

  markets() {
    return [{ id: 'US', name: 'United States' }];
  }

  async execute<T>(
    capabilityId: CapabilityId,
    input: unknown,
    signal?: AbortSignal
  ): Promise<ProviderResult<T>> {
    const result = await this.handler(capabilityId, input, signal);
    const typed = result as ProviderResult<T>;
    return typed;
  }
}

class FakeBrokerAccountProvider implements BrokerAccountProvider {
  kind = 'broker-account' as const;

  constructor(readonly id: string, readonly name: string) {}

  async status(): Promise<ProviderHealth> {
    return { status: 'connected', lastCheck: 1234 };
  }

  async accounts(): Promise<ProviderResult<BrokerAccount[]>> {
    return success(this.id, this.name, [{ id: 'acct', name: 'Default' }]);
  }

  async getPortfolio(
    accountId?: string,
    signal?: AbortSignal
  ): Promise<ProviderResult<PortfolioSnapshot>> {
    const snapshot: PortfolioSnapshot = { accounts: [], holdings: [], fetchedAt: 1000 };
    return success(this.id, this.name, snapshot);
  }

  async getPositions(
    accountId?: string,
    signal?: AbortSignal
  ): Promise<ProviderResult<Holding[]>> {
    return success(this.id, this.name, []);
  }

  async getAssets(
    accountId?: string,
    signal?: AbortSignal
  ): Promise<ProviderResult<AccountAssets[]>> {
    return success(this.id, this.name, []);
  }

  async getCashFlow(
    accountId?: string,
    options?: unknown,
    signal?: AbortSignal
  ): Promise<ProviderResult<CashFlowRecord[]>> {
    return success(this.id, this.name, []);
  }
}

describe('ProviderRegistry', () => {
  it('registers and lists providers by id', () => {
    const registry = new ProviderRegistry();
    const primary = new FakeFinancialDataProvider('p', 'Primary', ['market.quote']);
    registry.register(primary);
    expect(registry.get('p')).toBe(primary);
    expect(registry.list()).toEqual([primary]);
  });

  it('throws on duplicate id', () => {
    const registry = new ProviderRegistry();
    registry.register(new FakeFinancialDataProvider('p', 'Primary', ['market.quote']));
    expect(() =>
      registry.register(new FakeFinancialDataProvider('p', 'Other', ['market.depth']))
    ).toThrow(/already registered/);
  });
});

describe('ProviderRouter.execute', () => {
  it('returns the primary result on success', async () => {
    const router = new ProviderRouter();
    let fallbackCalls = 0;
    router.register(
      new FakeFinancialDataProvider('primary', 'Primary', ['market.quote'], async () =>
        success('primary', 'Primary', { value: 'p' })
      )
    );
    router.register(
      new FakeFinancialDataProvider('fallback', 'Fallback', ['market.quote'], async () => {
        fallbackCalls += 1;
        return success('fallback', 'Fallback', { value: 'f' });
      })
    );
    router.setRouting({ primary: 'primary', fallback: 'fallback' });

    const result = await router.execute<{ value: string }>('market.quote', { symbol: 'AAPL.US' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.value).toBe('p');
      expect(result.provenance.providerId).toBe('primary');
    }
    expect(fallbackCalls).toBe(0);
  });

  it('falls back on primary failure and keeps the fallback provenance (spec §62)', async () => {
    const router = new ProviderRouter();
    router.register(
      new FakeFinancialDataProvider('primary', 'Primary', ['market.quote'], async () =>
        failure('TIMEOUT', 'primary timed out')
      )
    );
    router.register(
      new FakeFinancialDataProvider('fallback', 'Fallback', ['market.quote'], async () =>
        success('fallback', 'Fallback', { value: 'f' })
      )
    );
    router.setRouting({ primary: 'primary', fallback: 'fallback' });

    const result = await router.execute<{ value: string }>('market.quote', {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.value).toBe('f');
      expect(result.provenance.providerId).toBe('fallback');
      expect(result.provenance.providerName).toBe('Fallback');
    }
  });

  it('skips an unsupported primary and serves from the fallback', async () => {
    const router = new ProviderRouter();
    let primaryCalls = 0;
    router.register(
      new FakeFinancialDataProvider('primary', 'Primary', ['market.quote'], async () => {
        primaryCalls += 1;
        return success('primary', 'Primary', { value: 'p' });
      })
    );
    router.register(
      new FakeFinancialDataProvider('fallback', 'Fallback', ['market.depth'], async () =>
        success('fallback', 'Fallback', { depth: 42 })
      )
    );
    router.setRouting({ primary: 'primary', fallback: 'fallback' });

    const result = await router.execute<{ depth: number }>('market.depth', {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.depth).toBe(42);
      expect(result.provenance.providerId).toBe('fallback');
    }
    expect(primaryCalls).toBe(0);
  });

  it('does not fall back when the primary returns ABORTED', async () => {
    const router = new ProviderRouter();
    let fallbackCalls = 0;
    router.register(
      new FakeFinancialDataProvider('primary', 'Primary', ['market.quote'], async () =>
        failure('ABORTED', 'aborted')
      )
    );
    router.register(
      new FakeFinancialDataProvider('fallback', 'Fallback', ['market.quote'], async () => {
        fallbackCalls += 1;
        return success('fallback', 'Fallback', { value: 'f' });
      })
    );
    router.setRouting({ primary: 'primary', fallback: 'fallback' });

    const result = await router.execute('market.quote', {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ABORTED');
    }
    expect(fallbackCalls).toBe(0);
  });

  it('returns ABORTED immediately when the signal is already aborted', async () => {
    const router = new ProviderRouter();
    let primaryCalls = 0;
    router.register(
      new FakeFinancialDataProvider('primary', 'Primary', ['market.quote'], async () => {
        primaryCalls += 1;
        return success('primary', 'Primary', { value: 'p' });
      })
    );
    router.setRouting({ primary: 'primary' });

    const controller = new AbortController();
    controller.abort();
    const result = await router.execute('market.quote', {}, controller.signal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ABORTED');
    }
    expect(primaryCalls).toBe(0);
  });

  it('returns the last error when all candidates fail', async () => {
    const router = new ProviderRouter();
    router.register(
      new FakeFinancialDataProvider('primary', 'Primary', ['market.quote'], async () =>
        failure('AUTH_EXPIRED', 'auth gone')
      )
    );
    router.register(
      new FakeFinancialDataProvider('fallback', 'Fallback', ['market.quote'], async () =>
        failure('RATE_LIMITED', 'slow down')
      )
    );
    router.setRouting({ primary: 'primary', fallback: 'fallback' });

    const result = await router.execute('market.quote', {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('RATE_LIMITED');
    }
  });

  it('returns UNSUPPORTED_CAPABILITY when nothing covers the capability', async () => {
    const router = new ProviderRouter();
    router.register(new FakeFinancialDataProvider('primary', 'Primary', ['market.quote']));
    router.setRouting({ primary: 'primary' });

    const result = await router.execute('market.depth', {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNSUPPORTED_CAPABILITY');
    }
  });

  it('dispatches a broker capability straight to a broker fallback', async () => {
    const router = new ProviderRouter();
    router.register(new FakeFinancialDataProvider('primary', 'Primary', ['market.quote']));
    const broker = new FakeBrokerAccountProvider('broker', 'Broker');
    router.register(broker);
    router.setRouting({ primary: 'primary', fallback: 'broker' });

    const result = await router.execute<PortfolioSnapshot>('portfolio.summary', {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.provenance.providerId).toBe('broker');
      expect(result.data.fetchedAt).toBe(1000);
    }
  });
});

describe('ProviderRouter.coverage + capabilityMapping', () => {
  it('builds a coverage matrix, including the four broker capabilities', () => {
    const router = new ProviderRouter();
    router.register(new FakeFinancialDataProvider('market', 'Market', ['market.quote', 'market.depth']));
    router.register(new FakeBrokerAccountProvider('broker', 'Broker'));

    const coverage = router.coverage();
    const market = coverage.find((entry) => entry.providerId === 'market');
    const broker = coverage.find((entry) => entry.providerId === 'broker');

    expect(market?.capabilities).toEqual(['market.quote', 'market.depth']);
    expect(market?.markets).toEqual([{ id: 'US', name: 'United States' }]);
    expect(broker?.capabilities).toEqual([...BROKER_CAPABILITY_IDS]);
    expect(broker?.markets).toEqual([]);
  });

  it('maps capabilities to ordered provider chains', () => {
    const coverage = [
      { providerId: 'primary', capabilities: ['market.quote', 'portfolio.summary'], markets: [] },
      { providerId: 'fallback', capabilities: ['market.quote', 'market.depth'], markets: [] },
    ];
    const mapping = capabilityMapping({ primary: 'primary', fallback: 'fallback' }, coverage);

    expect(mapping.get('market.quote')).toEqual(['primary', 'fallback']);
    expect(mapping.get('portfolio.summary')).toEqual(['primary']);
    expect(mapping.get('market.depth')).toEqual(['fallback']);
  });
});

describe('ConnectionStore', () => {
  let dir = '';
  let store: JsonFileStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'finagent-connections-'));
    store = new JsonFileStore(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips connection state through the file', async () => {
    const connections = new ConnectionStore(store);
    await connections.update({
      providerId: 'longbridge',
      status: 'connected',
      lastCheck: 1000,
      connectedAt: 900,
    });
    await connections.update({
      providerId: 'broker',
      status: 'error',
      lastCheck: 1001,
      error: { code: 'AUTH_EXPIRED', message: 're-auth needed' },
    });

    expect(await connections.list()).toHaveLength(2);
    expect(await connections.get('longbridge')).toMatchObject({ providerId: 'longbridge', status: 'connected' });

    // A fresh store over the same dir reads the persisted file back.
    const reloaded = new ConnectionStore(new JsonFileStore(dir));
    const reloadedList = await reloaded.list();
    expect(reloadedList).toHaveLength(2);
    expect(reloadedList.find((state) => state.providerId === 'broker')?.error?.code).toBe('AUTH_EXPIRED');
  });

  it('notifies subscribers on update and supports unsubscribe', async () => {
    const connections = new ConnectionStore(store);
    const seen: string[][] = [];
    const unsubscribe = connections.subscribe((states) => {
      seen.push(states.map((state) => state.providerId));
    });

    await connections.update({ providerId: 'a', status: 'connected', lastCheck: 1 });
    await connections.update({ providerId: 'b', status: 'connecting', lastCheck: 2 });
    expect(seen).toHaveLength(2);

    unsubscribe();
    await connections.update({ providerId: 'c', status: 'connected', lastCheck: 3 });
    expect(seen).toHaveLength(2);
  });
});

describe('createRouterFetchers', () => {
  it('returns data on success', async () => {
    const router = new ProviderRouter();
    const quote = {
      symbol: 'AAPL.US',
      lastPrice: 224.12,
      change: 0,
      changePercent: 0,
      volume: 0,
      timestamp: 1000,
      high: 0,
      low: 0,
      open: 0,
      prevClose: 0,
    };
    router.register(
      new FakeFinancialDataProvider('primary', 'Primary', ['market.quote'], async () =>
        success('primary', 'Primary', quote)
      )
    );
    router.setRouting({ primary: 'primary' });

    const fetchers = createRouterFetchers(router);
    const result = await fetchers.getQuote('AAPL.US');
    expect(result).toEqual(quote);
  });

  it('throws a normalized ProviderFetchError on failure', async () => {
    const router = new ProviderRouter();
    router.register(
      new FakeFinancialDataProvider('primary', 'Primary', ['market.quote'], async () =>
        failure('RATE_LIMITED', 'slow down')
      )
    );
    router.setRouting({ primary: 'primary' });

    const fetchers = createRouterFetchers(router);
    let caught: unknown;
    try {
      await fetchers.getQuote('AAPL.US');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProviderFetchError);
    if (caught instanceof ProviderFetchError) {
      expect(caught.code).toBe('RATE_LIMITED');
      expect(caught.message).toBe('slow down');
    }
  });
});

describe('healthAll', () => {
  it('returns per-provider snapshots', async () => {
    const providers = [
      new FakeFinancialDataProvider('a', 'A', ['market.quote']),
      new FakeBrokerAccountProvider('b', 'B'),
    ];
    const snapshots = await healthAll(providers);
    expect(snapshots).toHaveLength(2);
    expect(snapshots.map((snapshot) => snapshot.status)).toEqual(['connected', 'connected']);
  });

  it('degrades a throwing status() to an error snapshot', async () => {
    const broken = new FakeFinancialDataProvider('broken', 'Broken', [], async () =>
      success('broken', 'Broken', undefined)
    );
    const originalStatus = broken.status.bind(broken);
    broken.status = async () => {
      await originalStatus();
      throw new Error('boom');
    };
    const snapshots = await healthAll([broken]);
    expect(snapshots[0].status).toBe('error');
  });
});
