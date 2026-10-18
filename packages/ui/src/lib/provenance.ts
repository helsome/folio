import type { CapabilityProvenance, Comparison, ProviderProvenance } from '@finagent/core';
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

export interface ProviderSummary {
  /** The one actual provider name; undefined when sources are mixed/unknown. */
  providerName?: string;
  /** True when at least two distinct providers contributed cells/quotes. */
  mixed: boolean;
  delayed: boolean;
}

function summarize(names: Iterable<string | undefined>, delayed: boolean): ProviderSummary {
  const distinct = new Set<string>();
  for (const name of names) if (name) distinct.add(name);
  return {
    providerName: distinct.size === 1 ? [...distinct][0] : undefined,
    mixed: distinct.size > 1,
    delayed,
  };
}

/**
 * Header summary for a comparison table. A table whose cells come from
 * different providers must NOT be labeled with a single provider badge — it
 * summarizes as mixed, and per-cell detail lives on the cells themselves.
 */
export function summarizeComparisonProviders(comparison: Comparison | null): ProviderSummary {
  if (!comparison) return { mixed: false, delayed: false };
  const names: Array<string | undefined> = [];
  let delayed = false;
  for (const row of comparison.rows) {
    for (const cell of Object.values(row.cells)) {
      const provenance = cell.provenance;
      if (!provenance) continue;
      names.push(sourceName(provenance));
      if (provenance.delayed) delayed = true;
    }
  }
  return summarize(names, delayed);
}

/**
 * Header summary for quote-driven surfaces (Watchlist): distinct actual
 * providers across loaded quotes. Quotes without provenance stay unknown and
 * never default the surface back to a hardcoded provider name.
 */
export function summarizeQuoteProviders(quotes: Array<{ provenance?: ProviderProvenance }>): ProviderSummary {
  const names: Array<string | undefined> = [];
  let delayed = false;
  for (const quote of quotes) {
    const provenance = quote.provenance;
    if (!provenance) continue;
    names.push(sourceName(provenance));
    if (provenance.delayed) delayed = true;
  }
  return summarize(names, delayed);
}
