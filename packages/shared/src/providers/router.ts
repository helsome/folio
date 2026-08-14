import type {
  BrokerAccountProvider,
  CapabilityId,
  FinancialDataProvider,
  FinancialProviderRouter,
  ProviderCoverage,
  ProviderError,
  ProviderResult,
  ProviderRoutingConfig,
} from '@finagent/core';
import { isRecord } from '../guards.ts';
import { BROKER_CAPABILITY_IDS } from './coverage.ts';
import { ProviderRegistry, type AnyProvider } from './registry.ts';

const ABORTED: ProviderError = { code: 'ABORTED', message: 'Request aborted' };

function unsupported(capabilityId: CapabilityId): ProviderError {
  return {
    code: 'UNSUPPORTED_CAPABILITY',
    message: `No provider supports capability "${capabilityId}"`,
  };
}

/** A provider supports a capability it declared, or (brokers) a portfolio cap. */
function supports(provider: AnyProvider, capabilityId: CapabilityId): boolean {
  if (provider.kind === 'financial-data') {
    return provider.capabilities().includes(capabilityId);
  }
  return BROKER_CAPABILITY_IDS.includes(capabilityId);
}

function readAccountId(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  const accountId = input.accountId;
  return typeof accountId === 'string' ? accountId : undefined;
}

function readOptions(input: unknown): unknown {
  if (!isRecord(input)) return undefined;
  return input.options;
}

/**
 * PRIMARY + OPTIONAL FALLBACK router (spec §6). Candidate order is primary
 * then fallback; a provider that does not support the capability is skipped
 * (so an unsupported primary goes straight to the fallback). A primary
 * `ProviderError` (other than `ABORTED`) or timeout falls through to the
 * fallback, whose result carries the FALLBACK's provenance — never faked
 * (spec §62). `ABORTED` never triggers fallback.
 */
export class ProviderRouter implements FinancialProviderRouter {
  private readonly registry = new ProviderRegistry();
  private routing: ProviderRoutingConfig = { primary: '' };

  register(provider: AnyProvider): void {
    this.registry.register(provider);
  }

  get(id: string): AnyProvider | undefined {
    return this.registry.get(id);
  }

  list(): AnyProvider[] {
    return this.registry.list();
  }

  setRouting(config: ProviderRoutingConfig): void {
    this.routing = { primary: config.primary, fallback: config.fallback };
  }

  getRouting(): ProviderRoutingConfig {
    return { primary: this.routing.primary, fallback: this.routing.fallback };
  }

  coverage(): ProviderCoverage[] {
    return this.list().map((provider) => this.coverageFor(provider));
  }

  async execute<T>(
    capabilityId: CapabilityId,
    input: unknown,
    signal?: AbortSignal
  ): Promise<ProviderResult<T>> {
    if (signal?.aborted) {
      return { ok: false, error: ABORTED };
    }

    const order = [this.routing.primary, this.routing.fallback].filter(
      (id): id is string => typeof id === 'string' && id.length > 0
    );

    let lastError: ProviderError | undefined;
    for (const id of order) {
      const provider = this.get(id);
      if (!provider || !supports(provider, capabilityId)) {
        continue;
      }
      const result = await this.invoke<T>(provider, capabilityId, input, signal);
      if (result.ok) {
        return result;
      }
      lastError = result.error;
      if (result.error.code === 'ABORTED') {
        return result;
      }
    }

    if (lastError) {
      return { ok: false, error: lastError };
    }
    return { ok: false, error: unsupported(capabilityId) };
  }

  private coverageFor(provider: AnyProvider): ProviderCoverage {
    if (provider.kind === 'financial-data') {
      return {
        providerId: provider.id,
        capabilities: provider.capabilities(),
        markets: provider.markets(),
      };
    }
    return {
      providerId: provider.id,
      capabilities: [...BROKER_CAPABILITY_IDS],
      markets: [],
    };
  }

  private async invoke<T>(
    provider: AnyProvider,
    capabilityId: CapabilityId,
    input: unknown,
    signal?: AbortSignal
  ): Promise<ProviderResult<T>> {
    if (provider.kind === 'financial-data') {
      return provider.execute<T>(capabilityId, input, signal);
    }
    const result = await this.invokeBroker(provider, capabilityId, input, signal);
    const typed = result as ProviderResult<T>;
    return typed;
  }

  private async invokeBroker(
    provider: BrokerAccountProvider,
    capabilityId: CapabilityId,
    input: unknown,
    signal?: AbortSignal
  ): Promise<ProviderResult<unknown>> {
    const accountId = readAccountId(input);
    switch (capabilityId) {
      case 'portfolio.summary':
        return provider.getPortfolio(accountId, signal);
      case 'portfolio.positions':
        return provider.getPositions(accountId, signal);
      case 'portfolio.assets':
        return provider.getAssets(accountId, signal);
      case 'portfolio.cashFlow':
        return provider.getCashFlow(accountId, readOptions(input), signal);
      default:
        return { ok: false, error: unsupported(capabilityId) };
    }
  }
}
