import { createHash } from 'node:crypto';
import type {
  FinancialEvidenceEnvelope,
  FinancialEvidenceKind,
  FinancialEvidenceLineageStep,
  FinancialEvidenceMetadata,
  FinancialEvidenceValue,
  ToolCall,
} from '@finagent/core';
import {
  FINANCIAL_EVIDENCE_SCHEMA_VERSION,
  FINANCIAL_NORMALIZATION_VERSION,
} from '@finagent/core';

const SECRET_KEY = /(authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|password|cookie|secret|credential)/i;
const MAX_VALUES = 200;

const TOOL_CAPABILITIES: Record<string, { capabilityId: string; kind: FinancialEvidenceKind }> = {
  get_quote: { capabilityId: 'market.quote', kind: 'quote' },
  get_kline: { capabilityId: 'market.kline', kind: 'historical' },
  get_intraday: { capabilityId: 'market.intraday', kind: 'historical' },
  get_financials: { capabilityId: 'company.financials', kind: 'fundamental' },
  get_valuation: { capabilityId: 'company.valuation', kind: 'fundamental' },
  get_company_profile: { capabilityId: 'company.profile', kind: 'fundamental' },
  get_portfolio: { capabilityId: 'portfolio.summary', kind: 'portfolio' },
  get_positions: { capabilityId: 'portfolio.positions', kind: 'portfolio' },
  get_assets: { capabilityId: 'portfolio.assets', kind: 'portfolio' },
  get_cash_flow: { capabilityId: 'portfolio.cashFlow', kind: 'portfolio' },
};

interface StructuredResult {
  data: unknown;
  provenance?: Record<string, unknown>;
  evidence?: FinancialEvidenceMetadata;
}

export interface BuildFinancialEvidenceInput {
  sessionId: string;
  runId: string;
  toolCalls: ToolCall[];
}

/** Convert completed financial tool calls into redacted, deterministic evidence records. */
export function buildFinancialEvidence(input: BuildFinancialEvidenceInput): FinancialEvidenceEnvelope[] {
  return input.toolCalls.flatMap((toolCall) => {
    if (toolCall.status !== 'success' || toolCall.result === undefined) return [];
    const mapping = TOOL_CAPABILITIES[toolCall.toolName];
    if (!mapping) return [];
    const result = readStructuredResult(toolCall.result);
    const provenance = result.provenance ?? {};
    const provider = stringValue(provenance.providerId) ?? stringValue(provenance.provider) ?? 'unknown';
    const retrievedAt = numberValue(provenance.fetchedAt) ?? toolCall.completedAt ?? toolCall.startedAt;
    const asOf = numberValue(provenance.marketTime) ?? inferAsOf(result.data);
    const instrumentId = canonicalInstrument(toolCall.args.symbol ?? inferSymbol(result.data));
    const values = collectValues(result.data, result.evidence);
    const snapshot = redact(result.data);
    const resultHash = hashJson(snapshot);
    const lineage: FinancialEvidenceLineageStep[] = [
      { kind: 'provider', description: `Retrieved ${mapping.capabilityId} from ${provider}.` },
      ...(result.evidence?.lineage ?? []),
      {
        kind: 'normalization',
        description: 'Mapped provider output into the canonical Folio capability result.',
        version: FINANCIAL_NORMALIZATION_VERSION,
      },
    ];
    return [{
      schemaVersion: FINANCIAL_EVIDENCE_SCHEMA_VERSION,
      normalizationVersion: FINANCIAL_NORMALIZATION_VERSION,
      id: `fe_${hashText(`${input.runId}:${toolCall.id}:${resultHash}`).slice(0, 24)}`,
      sessionId: input.sessionId,
      runId: input.runId,
      toolCallId: toolCall.id,
      toolName: toolCall.toolName,
      kind: mapping.kind,
      ...(instrumentId ? { instrumentId } : {}),
      capabilityId: mapping.capabilityId,
      provider,
      ...(result.evidence?.dataset ? { dataset: result.evidence.dataset } : {}),
      query: redact(toolCall.args) as Record<string, unknown>,
      values,
      retrievedAt,
      ...(asOf !== undefined ? { asOf } : {}),
      stale: provenance.stale === true,
      cacheHit: result.evidence?.cacheHit === true,
      ...(result.evidence?.fallback ? { fallback: result.evidence.fallback } : {}),
      ...(result.evidence?.reconciliation ? { reconciliation: result.evidence.reconciliation } : {}),
      resultSnapshot: snapshot,
      resultHash,
      lineage,
    }];
  });
}

/** Runtime guard used by claim verifiers and import/export boundaries. */
export function isFinancialEvidenceEnvelope(value: unknown): value is FinancialEvidenceEnvelope {
  const record = asRecord(value);
  return record.schemaVersion === FINANCIAL_EVIDENCE_SCHEMA_VERSION
    && typeof record.id === 'string'
    && typeof record.runId === 'string'
    && typeof record.toolCallId === 'string'
    && Array.isArray(record.values);
}

/** Deterministic, redacted JSON export for audit/re-import. */
export function financialEvidenceToJson(evidence: FinancialEvidenceEnvelope[]): string {
  return `${JSON.stringify({
    schemaVersion: FINANCIAL_EVIDENCE_SCHEMA_VERSION,
    evidence: redact(evidence),
  }, null, 2)}\n`;
}

function readStructuredResult(value: unknown): StructuredResult {
  const record = asRecord(value);
  if ('data' in record) {
    return {
      data: record.data,
      provenance: asRecord(record.provenance),
      evidence: asRecord(record.evidence) as StructuredResult['evidence'],
    };
  }
  return { data: value };
}

function collectValues(data: unknown, metadata?: StructuredResult['evidence']): FinancialEvidenceValue[] {
  const values: FinancialEvidenceValue[] = [];
  const visit = (value: unknown, path: string): void => {
    if (values.length >= MAX_VALUES) return;
    if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean' || value === null) {
      if (!path || (typeof value !== 'number' && !looksNumeric(value))) return;
      values.push({
        metric: path,
        originalValue: metadata?.rawValues?.[path] ?? value,
        normalizedValue: value,
        ...(metadata?.units?.[path] ? { unit: metadata.units[path] } : {}),
        ...(metadata?.currencies?.[path] ? { currency: metadata.currencies[path] } : {}),
        ...(metadata?.periods?.[path] ? { period: metadata.periods[path] } : {}),
        ...(isTimeMetric(path) && typeof value === 'number' ? { asOf: value } : {}),
      });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((child, index) => visit(child, path ? `${path}.${index}` : String(index)));
      return;
    }
    for (const [key, child] of Object.entries(asRecord(value))) {
      visit(child, path ? `${path}.${key}` : key);
    }
  };
  visit(data, '');
  return values;
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(key)) continue;
    output[key] = redact(child);
  }
  return output;
}

function canonicalInstrument(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z0-9]{1,5}\.(US|HK|SG|SH|SZ|HAS)$/.test(normalized) ? normalized : undefined;
}

function inferSymbol(data: unknown): unknown {
  const record = asRecord(Array.isArray(data) ? data[0] : data);
  return record.symbol;
}

function inferAsOf(data: unknown): number | undefined {
  const record = asRecord(Array.isArray(data) ? data[0] : data);
  return numberValue(record.asOf) ?? numberValue(record.timestamp) ?? numberValue(record.time);
}

function isTimeMetric(path: string): boolean {
  return /(?:^|\.)(?:asOf|timestamp|time|date)$/i.test(path);
}

function looksNumeric(value: unknown): boolean {
  return typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hashJson(value: unknown): string {
  return `sha256:${hashText(JSON.stringify(value))}`;
}
