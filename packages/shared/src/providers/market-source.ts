import type { MarketSource, ProviderProvenance } from '@finagent/core';

/** Use the answering provider's provenance for every market-data projection. */
export function marketSourceOf(provenance: ProviderProvenance): MarketSource {
  return {
    providerId: provenance.providerId,
    providerName: provenance.providerName,
    ...(provenance.delayed === true ? { delayed: true } : {}),
  };
}
