import { describe, expect, it } from 'bun:test';
import type {
  AccountAssets,
  BrokerAccount,
  BrokerAccountProvider,
  CashFlowRecord,
  Holding,
  PortfolioSnapshot,
  ProviderHealth,
  ProviderProvenance,
  ProviderResult,
} from '@finagent/core';
import { createPortfolioAssetsCapability } from '../capabilities/manifests/phase-two.ts';
import { createRouterFetchers } from './router-fetchers.ts';
import { ProviderRouter } from './router.ts';

const provenance: ProviderProvenance = {
  providerId: 'broker-under-test',
  providerName: 'Broker Under Test',
  fetchedAt: 1000,
  stale: false,
};

function assets(currency: string): AccountAssets {
  return {
    currency,
    netAssets: 100,
    totalCash: 10,
    cashInfos: [{ currency, availableCash: 10 }],
  };
}

type AssetCall = { accountId: string | undefined; currency: string | undefined };

/**
 * A broker provider standing in for the real vendor: the vendor CLI returns one
 * entry per reporting currency and narrows it only when `--currency` is passed.
 * `assetCalls` records what the router actually forwarded.
 */
class RecordingBrokerProvider implements BrokerAccountProvider {
  readonly kind = 'broker-account' as const;
  readonly id = 'broker-under-test';
  readonly name = 'Broker Under Test';
  readonly assetCalls: AssetCall[] = [];

  async status(): Promise<ProviderHealth> {
    return { status: 'connected', lastCheck: 1000 };
  }

  async accounts(): Promise<ProviderResult<BrokerAccount[]>> {
    return { ok: true, data: [{ id: 'A1', name: 'A1' }], provenance };
  }

  async getPortfolio(): Promise<ProviderResult<PortfolioSnapshot>> {
    return { ok: true, data: { accounts: [], holdings: [], fetchedAt: 1000 }, provenance };
  }

  async getPositions(): Promise<ProviderResult<Holding[]>> {
    return { ok: true, data: [], provenance };
  }

  async getAssets(
    accountId?: string,
    _signal?: AbortSignal,
    currency?: string
  ): Promise<ProviderResult<AccountAssets[]>> {
    this.assetCalls.push({ accountId, currency });
    const rows = currency ? [assets(currency)] : [assets('USD'), assets('HKD')];
    return { ok: true, data: rows, provenance };
  }

  async getCashFlow(): Promise<ProviderResult<CashFlowRecord[]>> {
    return { ok: true, data: [], provenance };
  }
}

function routedBroker(): { router: ProviderRouter; broker: RecordingBrokerProvider } {
  const router = new ProviderRouter();
  const broker = new RecordingBrokerProvider();
  router.register(broker);
  return { router, broker };
}

describe('portfolio.assets currency pass-through', () => {
  it('forwards the requested currency to the broker provider', async () => {
    const { router, broker } = routedBroker();

    const result = await router.execute<AccountAssets[]>('portfolio.assets', { currency: 'HKD' });

    expect(result.ok).toBe(true);
    expect(broker.assetCalls).toEqual([{ accountId: undefined, currency: 'HKD' }]);
  });

  it('narrows the returned rows end-to-end through the get_assets capability', async () => {
    const { router } = routedBroker();
    const capability = createPortfolioAssetsCapability(createRouterFetchers(router));

    const outcome = await capability.execute({ currency: 'HKD' }, {});

    expect(outcome.data.map((row) => row.currency)).toEqual(['HKD']);
  });

  it('keeps forwarding accountId alongside the currency', async () => {
    const { router, broker } = routedBroker();

    await router.execute('portfolio.assets', { accountId: 'A1', currency: 'USD' });

    expect(broker.assetCalls).toEqual([{ accountId: 'A1', currency: 'USD' }]);
  });

  it('lists every currency when no filter is requested (existing behaviour)', async () => {
    const { router, broker } = routedBroker();

    const result = await router.execute<AccountAssets[]>('portfolio.assets', {});

    expect(result.ok).toBe(true);
    expect(broker.assetCalls).toEqual([{ accountId: undefined, currency: undefined }]);
    expect(result.ok && result.data.map((row) => row.currency)).toEqual(['USD', 'HKD']);
  });

  it('keeps the empty-input path working through the capability', async () => {
    const { router } = routedBroker();
    const capability = createPortfolioAssetsCapability(createRouterFetchers(router));

    const outcome = await capability.execute({}, {});

    expect(outcome.data.map((row) => row.currency)).toEqual(['USD', 'HKD']);
  });
});
