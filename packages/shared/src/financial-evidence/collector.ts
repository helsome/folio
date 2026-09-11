import type {
  CapabilityResult,
  CapabilityRunRecord,
  FinancialEvidenceEnvelope,
} from '@finagent/core';
import {
  buildEvidenceEnvelope,
  buildDefaultLineage,
  extractQuoteMetrics,
  extractValuationMetrics,
  extractKlineMetrics,
  inferCurrency,
  type FinancialEvidenceMetric,
} from '@finagent/core';
import { createHash } from 'node:crypto';

/**
 * EvidenceCollector — generates FinancialEvidenceEnvelopes from capability
 * execution results and persists them for later lookup.
 *
 * This is the single integration point between the capability execution layer
 * and the evidence chain. Every successful capability result that produces
 * structured financial data passes through here.
 */

export interface CollectEvidenceArgs {
  runRecord: CapabilityRunRecord;
  result: CapabilityResult<unknown>;
  input: unknown;
  agentRunId?: string;
  sessionId?: string;
  cacheHit?: boolean;
}

/**
 * Sanitize query parameters: remove anything that looks like a secret.
 * The redaction rule mirrors export/privacy.ts but applied at collection time
 * so secrets never even enter the envelope.
 */
function sanitizeQueryParams(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object') return {};
  const out: Record<string, unknown> = {};
  const SECRET_KEY = /(apiKey|api_key|token|secret|password|auth|credential)/i;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (SECRET_KEY.test(key)) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Compute a minimal snapshot hash of the provider result data.
 * We hash the normalized data, not the raw vendor output, to respect
 * data minimization principles while still providing auditability.
 */
function computeSnapshotHash(data: unknown): string {
  const serialized = JSON.stringify(data);
  return createHash('sha256').update(serialized).digest('hex').slice(0, 16);
}

/**
 * Extract the instrument id (symbol) from the input or result.
 */
function extractInstrumentId(capabilityId: string, input: unknown, resultData: unknown): string {
  // Try input first
  if (input && typeof input === 'object' && 'symbol' in input) {
    return String((input as Record<string, unknown>).symbol);
  }
  // Try result data
  if (resultData && typeof resultData === 'object' && 'symbol' in resultData) {
    return String((resultData as Record<string, unknown>).symbol);
  }
  return 'unknown';
}

/**
 * Extract evidence metrics from a capability result based on its capabilityId.
 * Supports the three required types: quote, fundamental (valuation), and historical (kline).
 */
function extractMetrics(capabilityId: string, data: unknown): FinancialEvidenceMetric[] {
  if (!data || typeof data !== 'object') return [];

  switch (capabilityId) {
    case 'market.quote':
      return extractQuoteMetrics(data as import('@finagent/core').Quote);

    case 'company.valuation':
      return extractValuationMetrics(data as import('@finagent/core').CalcIndex);

    case 'market.kline': {
      // Kline can be a single kline or an array
      if (Array.isArray(data)) {
        // For arrays, return metrics from the most recent entry
        const last = data[data.length - 1] as import('@finagent/core').Kline;
        return extractKlineMetrics(last);
      }
      return extractKlineMetrics(data as import('@finagent/core').Kline);
    }

    default:
      // Generic fallback: extract numeric top-level fields
      return extractGenericMetrics(data);
  }
}

/** Generic metric extraction for unsupported capability types. */
function extractGenericMetrics(data: Record<string, unknown>): FinancialEvidenceMetric[] {
  const metrics: FinancialEvidenceMetric[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'number') {
      metrics.push({
        metricId: key,
        metricName: key,
        originalValue: value,
        normalizedValue: value,
        adjustment: 'raw',
      });
    }
  }
  return metrics;
}

/**
 * Build a FinancialEvidenceEnvelope from a capability execution outcome.
 */
export function collectEvidence(args: CollectEvidenceArgs): FinancialEvidenceEnvelope | null {
  const { runRecord, result, input, agentRunId, sessionId, cacheHit } = args;

  if (runRecord.status !== 'success' || !result) return null;

  const instrumentId = extractInstrumentId(runRecord.capabilityId, input, result.data);
  const metrics = extractMetrics(runRecord.capabilityId, result.data);

  if (metrics.length === 0) return null;

  const queryParams = sanitizeQueryParams(input);
  const provider = result.provenance.provider;
  const retrievedAt = result.provenance.fetchedAt;
  const marketTime = result.provenance.marketTime;

  const envelope = buildEvidenceEnvelope({
    runId: runRecord.id,
    ...(agentRunId ? { agentRunId } : {}),
    ...(sessionId ? { sessionId } : {}),
    instrumentId,
    capabilityId: runRecord.capabilityId,
    provider,
    providerId: result.provenance.providerId,
    dataset: runRecord.capabilityId,
    queryParams,
    retrievedAt,
    marketTime,
    metrics,
    ...(cacheHit !== undefined ? { cacheHit } : {}),
    stale: result.provenance.stale,
    delayed: result.provenance.delayed,
    snapshotHash: computeSnapshotHash(result.data),
    lineage: buildDefaultLineage(provider, metrics, retrievedAt),
  });

  return envelope;
}
