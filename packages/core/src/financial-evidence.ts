/**
 * Financial Evidence Envelope domain (issue #29).
 *
 * Every structured financial tool result that enters the answer/report
 * evidence chain gets wrapped in a FinancialEvidenceEnvelope. This makes it
 * possible to answer: "where did this number come from?" with full lineage,
 * not just "provider=longbridge".
 *
 * The envelope is provider-neutral: providers map their raw output into
 * these shapes; research/agent/UI/export layers consume ONLY these shapes.
 */

import type { CapabilityId } from './capability.ts';

// ── Core Envelope ────────────────────────────────────────────────────────────

/**
 * A single metric value with its full provenance. One capability result
 * (e.g. a Quote) may produce multiple metric evidence entries (lastPrice,
 * changePercent, volume, …).
 */
export interface FinancialEvidenceMetric {
  /** Stable metric identity, e.g. `quote.lastPrice`, `valuation.pe`, `kline.close`. */
  metricId: string;
  /** Human-readable metric name, e.g. "Last Price", "P/E Ratio". */
  metricName: string;
  /** Original value as returned by the provider (before normalization). */
  originalValue: number | string | boolean | null;
  /** Value after normalization/transform (the one shown to the user). */
  normalizedValue: number | string | boolean | null;
  /** Unit of the normalized value, e.g. `USD`, `%`, `shares`, `ratio`. */
  unit?: string;
  /** Currency code when the value is monetary, e.g. `USD`, `HKD`. */
  currency?: string;
  /** Fiscal period / time bucket the metric applies to, e.g. `Q2 2026`, `TTM`, `2026-09-11`. */
  period?: string;
  /** Epoch seconds of the data's own timestamp (as-of date). */
  asOf?: number;
  /** Semantic meaning of any adjustment applied, e.g. `raw`, `adjusted_close`, `non_gaap`. */
  adjustment?: string;
}

/** One node in the lineage chain: raw → convert → normalize → derive → claim. */
export interface EvidenceLineageNode {
  /** What happened at this step, e.g. `currency_conversion`, `normalization`, `ratio_derivation`. */
  step: string;
  /** Human-readable description of the transform. */
  description?: string;
  /** Epoch ms when this step ran. */
  timestamp: number;
  /** Inputs consumed by this step (metric ids or raw data refs). */
  inputs: string[];
  /** Outputs produced by this step (metric ids). */
  outputs: string[];
  /** Version of the transform/normalization logic that ran. */
  transformVersion?: string;
}

/**
 * The full envelope wrapping one structured financial tool result.
 * Stored alongside the run record so it survives app restart and conversation
 * reload.
 */
export interface FinancialEvidenceEnvelope {
  /** Stable evidence id, e.g. `evidence-<runId>-<seq>`. */
  evidenceId: string;
  /** Run / tool call id this evidence belongs to (same as CapabilityRunRecord.id). */
  runId: string;
  /** Agent run id this evidence was produced in (the Copilot conversation run). */
  agentRunId?: string;
  /** Session id this evidence belongs to. */
  sessionId?: string;
  /** Canonical instrument id in CODE.MARKET form, e.g. `NVDA.US`, `0700.HK`. */
  instrumentId: string;
  /** Capability id that produced this evidence, e.g. `market.quote`. */
  capabilityId: CapabilityId;
  /** Provider id, e.g. `longbridge`, `polygon`. */
  provider: string;
  /** Actual answering provider id (fallback-aware). */
  providerId?: string;
  /** Dataset / sub-capability within the provider, e.g. `quote`, `fundamentals`, `kline_daily`. */
  dataset?: string;
  /** Sanitized query parameters (secrets removed). */
  queryParams: Record<string, unknown>;
  /** Epoch ms when the data was retrieved from the provider. */
  retrievedAt: number;
  /** Epoch ms of the data's own market timestamp. */
  marketTime?: number;
  /** Per-metric evidence records. */
  metrics: FinancialEvidenceMetric[];
  /** True when served from cache. */
  cacheHit?: boolean;
  /** True when the data is stale relative to live market. */
  stale?: boolean;
  /** True when the market was closed / data is delayed. */
  delayed?: boolean;
  /** Fallback / reconciliation metadata when a fallback provider served the request. */
  fallback?: {
    primaryProvider: string;
    fallbackProvider: string;
    reason: string;
  };
  /** Minimal auditable snapshot: hash of the provider's raw response. */
  snapshotHash?: string;
  /** Version of the normalization/transform pipeline. */
  transformVersion: string;
  /** Lineage chain from raw provider data to final claim. */
  lineage: EvidenceLineageNode[];
  /** Epoch ms when this envelope was persisted. */
  persistedAt: number;
}

// ── Builders ────────────────────────────────────────────────────────────────

export const EVIDENCE_TRANSFORM_VERSION = '1.0.0';

let evidenceSeq = 0;

/**
 * Build a FinancialEvidenceEnvelope from a capability execution result.
 * This is the main entry point used by the evidence collector.
 */
export function buildEvidenceEnvelope(args: {
  runId: string;
  agentRunId?: string;
  sessionId?: string;
  instrumentId: string;
  capabilityId: CapabilityId;
  provider: string;
  providerId?: string;
  dataset?: string;
  queryParams: Record<string, unknown>;
  retrievedAt: number;
  marketTime?: number;
  metrics: FinancialEvidenceMetric[];
  cacheHit?: boolean;
  stale?: boolean;
  delayed?: boolean;
  fallback?: FinancialEvidenceEnvelope['fallback'];
  snapshotHash?: string;
  lineage?: EvidenceLineageNode[];
}): FinancialEvidenceEnvelope {
  evidenceSeq += 1;
  return {
    evidenceId: `evidence-${args.runId}-${args.retrievedAt}-${evidenceSeq}`,
    runId: args.runId,
    ...(args.agentRunId ? { agentRunId: args.agentRunId } : {}),
    ...(args.sessionId ? { sessionId: args.sessionId } : {}),
    instrumentId: args.instrumentId,
    capabilityId: args.capabilityId,
    provider: args.provider,
    ...(args.providerId ? { providerId: args.providerId } : {}),
    ...(args.dataset ? { dataset: args.dataset } : {}),
    queryParams: args.queryParams,
    retrievedAt: args.retrievedAt,
    ...(args.marketTime !== undefined ? { marketTime: args.marketTime } : {}),
    metrics: args.metrics,
    ...(args.cacheHit !== undefined ? { cacheHit: args.cacheHit } : {}),
    ...(args.stale !== undefined ? { stale: args.stale } : {}),
    ...(args.delayed !== undefined ? { delayed: args.delayed } : {}),
    ...(args.fallback ? { fallback: args.fallback } : {}),
    ...(args.snapshotHash ? { snapshotHash: args.snapshotHash } : {}),
    transformVersion: EVIDENCE_TRANSFORM_VERSION,
    lineage: args.lineage ?? [],
    persistedAt: Date.now(),
  };
}

// ── Metric Extractors ────────────────────────────────────────────────────────

import type { Quote, CalcIndex, Kline } from './index.ts';

/** Extract evidence metrics from a Quote result. */
export function extractQuoteMetrics(quote: Quote): FinancialEvidenceMetric[] {
  return [
    {
      metricId: 'quote.lastPrice',
      metricName: 'Last Price',
      originalValue: quote.lastPrice,
      normalizedValue: quote.lastPrice,
      unit: 'price',
      currency: inferCurrency(quote.symbol),
      asOf: quote.timestamp,
      adjustment: 'raw',
    },
    {
      metricId: 'quote.change',
      metricName: 'Price Change',
      originalValue: quote.change,
      normalizedValue: quote.change,
      unit: 'price',
      currency: inferCurrency(quote.symbol),
      asOf: quote.timestamp,
      adjustment: 'raw',
    },
    {
      metricId: 'quote.changePercent',
      metricName: 'Change Percent',
      originalValue: quote.changePercent,
      normalizedValue: quote.changePercent,
      unit: '%',
      asOf: quote.timestamp,
      adjustment: 'raw',
    },
    {
      metricId: 'quote.volume',
      metricName: 'Volume',
      originalValue: quote.volume,
      normalizedValue: quote.volume,
      unit: 'shares',
      asOf: quote.timestamp,
      adjustment: 'raw',
    },
    {
      metricId: 'quote.high',
      metricName: 'Day High',
      originalValue: quote.high,
      normalizedValue: quote.high,
      unit: 'price',
      currency: inferCurrency(quote.symbol),
      asOf: quote.timestamp,
      adjustment: 'raw',
    },
    {
      metricId: 'quote.low',
      metricName: 'Day Low',
      originalValue: quote.low,
      normalizedValue: quote.low,
      unit: 'price',
      currency: inferCurrency(quote.symbol),
      asOf: quote.timestamp,
      adjustment: 'raw',
    },
    {
      metricId: 'quote.open',
      metricName: 'Open Price',
      originalValue: quote.open,
      normalizedValue: quote.open,
      unit: 'price',
      currency: inferCurrency(quote.symbol),
      asOf: quote.timestamp,
      adjustment: 'raw',
    },
    {
      metricId: 'quote.prevClose',
      metricName: 'Previous Close',
      originalValue: quote.prevClose,
      normalizedValue: quote.prevClose,
      unit: 'price',
      currency: inferCurrency(quote.symbol),
      asOf: quote.timestamp,
      adjustment: 'raw',
    },
  ];
}

/** Extract evidence metrics from a CalcIndex (valuation/fundamental) result. */
export function extractValuationMetrics(index: CalcIndex): FinancialEvidenceMetric[] {
  const metrics: FinancialEvidenceMetric[] = [];
  const currency = inferCurrency(index.symbol);

  if (index.pe !== undefined) {
    metrics.push({
      metricId: 'valuation.pe',
      metricName: 'P/E Ratio',
      originalValue: index.pe,
      normalizedValue: index.pe,
      unit: 'ratio',
      adjustment: 'raw',
    });
  }
  if (index.pb !== undefined) {
    metrics.push({
      metricId: 'valuation.pb',
      metricName: 'P/B Ratio',
      originalValue: index.pb,
      normalizedValue: index.pb,
      unit: 'ratio',
      adjustment: 'raw',
    });
  }
  if (index.dpsRate !== undefined) {
    metrics.push({
      metricId: 'valuation.dpsRate',
      metricName: 'Dividend Yield',
      originalValue: index.dpsRate,
      normalizedValue: index.dpsRate,
      unit: '%',
      adjustment: 'raw',
    });
  }
  if (index.totalMarketValue !== undefined) {
    metrics.push({
      metricId: 'valuation.totalMarketValue',
      metricName: 'Market Capitalization',
      originalValue: index.totalMarketValue,
      normalizedValue: index.totalMarketValue,
      unit: 'currency',
      currency,
      adjustment: 'raw',
    });
  }
  if (index.turnoverRate !== undefined) {
    metrics.push({
      metricId: 'valuation.turnoverRate',
      metricName: 'Turnover Rate',
      originalValue: index.turnoverRate,
      normalizedValue: index.turnoverRate,
      unit: '%',
      adjustment: 'raw',
    });
  }
  if (index.ytdChangeRate !== undefined) {
    metrics.push({
      metricId: 'valuation.ytdChangeRate',
      metricName: 'YTD Change',
      originalValue: index.ytdChangeRate,
      normalizedValue: index.ytdChangeRate,
      unit: '%',
      adjustment: 'raw',
    });
  }
  if (index.volumeRatio !== undefined) {
    metrics.push({
      metricId: 'valuation.volumeRatio',
      metricName: 'Volume Ratio',
      originalValue: index.volumeRatio,
      normalizedValue: index.volumeRatio,
      unit: 'ratio',
      adjustment: 'raw',
    });
  }
  if (index.amplitude !== undefined) {
    metrics.push({
      metricId: 'valuation.amplitude',
      metricName: 'Amplitude',
      originalValue: index.amplitude,
      normalizedValue: index.amplitude,
      unit: '%',
      adjustment: 'raw',
    });
  }
  return metrics;
}

/** Extract evidence metrics from a single Kline (historical data) entry. */
export function extractKlineMetrics(kline: Kline): FinancialEvidenceMetric[] {
  const currency = inferCurrency(kline.symbol);
  return [
    {
      metricId: 'kline.open',
      metricName: 'Open',
      originalValue: kline.open,
      normalizedValue: kline.open,
      unit: 'price',
      currency,
      asOf: kline.timestamp,
      adjustment: 'raw',
    },
    {
      metricId: 'kline.high',
      metricName: 'High',
      originalValue: kline.high,
      normalizedValue: kline.high,
      unit: 'price',
      currency,
      asOf: kline.timestamp,
      adjustment: 'raw',
    },
    {
      metricId: 'kline.low',
      metricName: 'Low',
      originalValue: kline.low,
      normalizedValue: kline.low,
      unit: 'price',
      currency,
      asOf: kline.timestamp,
      adjustment: 'raw',
    },
    {
      metricId: 'kline.close',
      metricName: 'Close',
      originalValue: kline.close,
      normalizedValue: kline.close,
      unit: 'price',
      currency,
      asOf: kline.timestamp,
      adjustment: 'raw',
    },
    {
      metricId: 'kline.volume',
      metricName: 'Volume',
      originalValue: kline.volume,
      normalizedValue: kline.volume,
      unit: 'shares',
      asOf: kline.timestamp,
      adjustment: 'raw',
    },
  ];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Infer currency from the market suffix of a CODE.MARKET symbol. */
export function inferCurrency(symbol: string): string {
  const parts = symbol.split('.');
  if (parts.length < 2) return 'USD';
  const market = parts[1].toUpperCase();
  switch (market) {
    case 'US':
      return 'USD';
    case 'HK':
      return 'HKD';
    case 'SH':
    case 'SZ':
    case 'HAS':
      return 'CNY';
    case 'SG':
      return 'SGD';
    default:
      return 'USD';
  }
}

/**
 * Build a minimal lineage chain from raw provider data to normalized metrics.
 * This is the default lineage for direct provider results (no intermediate transforms).
 */
export function buildDefaultLineage(
  provider: string,
  metrics: FinancialEvidenceMetric[],
  timestamp: number
): EvidenceLineageNode[] {
  const metricIds = metrics.map((m) => m.metricId);
  return [
    {
      step: 'provider_fetch',
      description: `Raw data fetched from ${provider}`,
      timestamp,
      inputs: ['provider_response'],
      outputs: metricIds,
      transformVersion: EVIDENCE_TRANSFORM_VERSION,
    },
    {
      step: 'normalization',
      description: 'Normalized vendor output to canonical types',
      timestamp,
      inputs: metricIds,
      outputs: metricIds,
      transformVersion: EVIDENCE_TRANSFORM_VERSION,
    },
  ];
}
