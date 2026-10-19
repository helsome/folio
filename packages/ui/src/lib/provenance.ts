import type { CapabilityProvenance, ProviderProvenance } from '@finagent/core';
import type { TFunction } from 'i18next';

/** Either provenance contract that can reach the renderer (#332). */
export type CellProvenance = CapabilityProvenance | ProviderProvenance;

function sourceName(provenance: CellProvenance): string | undefined {
  if (provenance.providerName) return provenance.providerName;
  if ('providerId' in provenance && provenance.providerId) return provenance.providerId;
  if ('provider' in provenance && provenance.provider) return provenance.provider;
  return undefined;
}

function formatTimestamp(epochMs: number): string {
  return new Date(epochMs).toLocaleString([], {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * One-line, per-cell source detail for tooltips: actual provider, the data's
 * own timestamp, retrieval time, and delayed/stale/failover state. Fields the
 * provenance does not carry render as `unknown` — never backfilled from the
 * current time or an assumed provider.
 */
export function describeProvenance(
  provenance: CellProvenance | undefined,
  t: TFunction
): string {
  const unknown = t('compare.source.unknown');
  if (!provenance) return `${t('compare.source.provider')}: ${unknown}`;
  const source = sourceName(provenance) ?? unknown;
  const parts: string[] = [`${t('compare.source.provider')}: ${source}`];
  parts.push(
    `${t('compare.source.asOf')}: ${
      provenance.marketTime ? formatTimestamp(provenance.marketTime) : unknown
    }`
  );
  parts.push(`${t('compare.source.retrievedAt')}: ${formatTimestamp(provenance.fetchedAt)}`);
  if (provenance.delayed) parts.push(t('compare.source.delayed'));
  if (provenance.stale) parts.push(t('compare.source.stale'));
  if (provenance.failoverTrail?.length) {
    const trail = provenance.failoverTrail.map((step) => step.providerId).join(' → ');
    parts.push(`${t('compare.source.failover')}: ${trail} → ${source}`);
  }
  return parts.join(' · ');
}
