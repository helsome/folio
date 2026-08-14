import type { BrokerAccountProvider, FinancialDataProvider } from '@finagent/core';

/** Any provider the router can dispatch to (financial-data or broker-account). */
export type AnyProvider = FinancialDataProvider | BrokerAccountProvider;

/**
 * Id-keyed provider registry. Registration order is preserved for `list()`;
 * duplicate ids are a programming error and throw immediately.
 */
export class ProviderRegistry {
  private readonly providers = new Map<string, AnyProvider>();

  register(provider: AnyProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`Provider with id "${provider.id}" is already registered`);
    }
    this.providers.set(provider.id, provider);
  }

  get(id: string): AnyProvider | undefined {
    return this.providers.get(id);
  }

  list(): AnyProvider[] {
    return [...this.providers.values()];
  }
}
