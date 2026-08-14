import type {
  BrokerAccountProvider,
  FinancialDataProvider,
  FinancialProviderRouter,
  ProviderHealth,
} from '@finagent/core';

/**
 * Collect per-provider health snapshots. `status()` MUST be cheap — it is
 * called on render and on demand ("Test Connection"), so it must never fetch
 * market data; providers report their connection lifecycle only (spec §8).
 *
 * `providers` is the explicit list; `router` is a fallback source when the
 * caller holds a router and no explicit list (kept optional so tests and the
 * kernel can pass exactly what they have).
 */
export async function healthAll(
  providers: (FinancialDataProvider | BrokerAccountProvider)[],
  router?: FinancialProviderRouter
): Promise<ProviderHealth[]> {
  const list = providers.length > 0 ? providers : (router?.list() ?? []);
  return Promise.all(list.map((provider) => snapshot(provider)));
}

async function snapshot(provider: FinancialDataProvider | BrokerAccountProvider): Promise<ProviderHealth> {
  try {
    return await provider.status();
  } catch (error) {
    return {
      status: 'error',
      lastCheck: Date.now(),
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
