import type {
  CapabilityId,
  ProviderCoverage,
  ProviderRoutingConfig,
} from '@finagent/core';

/**
 * The capabilities every broker-account provider serves (spec §7). These map
 * onto the four portfolio-shaped methods on `BrokerAccountProvider`; brokers
 * have no generic `capabilities()` so the router synthesizes them here.
 */
export const BROKER_CAPABILITY_IDS: readonly CapabilityId[] = [
  'portfolio.summary',
  'portfolio.positions',
  'portfolio.assets',
  'portfolio.cashFlow',
] as const;

/**
 * Pure capability → ordered provider chain mapping (spec §7). For each
 * capability covered by any provider, returns the routing order (primary then
 * fallback) filtered to the providers that actually support it.
 *
 * Kept pure (no I/O, no registry) so tests can exercise routing without
 * instantiating providers.
 */
export function capabilityMapping(
  routing: ProviderRoutingConfig,
  coverage: ProviderCoverage[]
): Map<CapabilityId, string[]> {
  const byProvider = new Map(coverage.map((entry) => [entry.providerId, entry]));
  const order = [routing.primary, routing.fallback].filter(
    (id): id is string => typeof id === 'string' && id.length > 0
  );

  const capabilityIds = new Set<CapabilityId>();
  for (const entry of coverage) {
    for (const capabilityId of entry.capabilities) {
      capabilityIds.add(capabilityId);
    }
  }

  const mapping = new Map<CapabilityId, string[]>();
  for (const capabilityId of capabilityIds) {
    const chain = order.filter((id) => byProvider.get(id)?.capabilities.includes(capabilityId));
    mapping.set(capabilityId, chain);
  }
  return mapping;
}
