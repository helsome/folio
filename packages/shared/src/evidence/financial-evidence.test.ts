import { describe, expect, it } from 'bun:test';
import type { ToolCall } from '@finagent/core';
import {
  buildFinancialEvidence,
  computeEnvelopeId,
  financialEvidenceToJson,
  isFinancialEvidenceEnvelope,
} from './financial-evidence.ts';

function call(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: 'call-1',
    toolName: 'get_quote',
    args: { symbol: 'aapl.us', apiKey: 'canary-secret' },
    startedAt: 100,
    completedAt: 120,
    status: 'success',
    result: {
      data: { symbol: 'AAPL.US', lastPrice: 210.5, currency: 'USD', timestamp: 110 },
      provenance: { providerId: 'longbridge', fetchedAt: 120, marketTime: 110, stale: false },
      evidence: {
        rawValues: { lastPrice: '210.50' },
        units: { lastPrice: 'price' },
        currencies: { lastPrice: 'USD' },
      },
    },
    ...overrides,
  };
}

describe('buildFinancialEvidence', () => {
  it('creates stable quote evidence with provider, instrument and value lineage', () => {
    const input = { sessionId: 'session-1', runId: 'run-1', toolCalls: [call()] };
    const first = buildFinancialEvidence(input)[0];
    const second = buildFinancialEvidence(input)[0];
    expect(first.id).toBe(second.id);
    expect(first).toMatchObject({
      schemaVersion: 'financial-evidence/v1',
      normalizationVersion: 'folio-normalization/v1',
      provider: 'longbridge',
      instrumentId: 'AAPL.US',
      capabilityId: 'market.quote',
      asOf: 110,
      stale: false,
    });
    expect(first.values.find((value) => value.metric === 'lastPrice')).toMatchObject({
      originalValue: '210.50',
      normalizedValue: 210.5,
      unit: 'price',
      currency: 'USD',
    });
    expect(first.lineage.at(-1)?.version).toBe('folio-normalization/v1');
  });

  it('keeps 6-digit A-share symbol arguments as the instrument id', () => {
    const records = buildFinancialEvidence({
      sessionId: 'session-1',
      runId: 'run-1',
      toolCalls: [call({ args: { symbol: '600519.SH' } })],
    });
    expect(records[0].instrumentId).toBe('600519.SH');
  });

  it('supports fundamental and historical results', () => {
    const records = buildFinancialEvidence({
      sessionId: 's',
      runId: 'r',
      toolCalls: [
        call({ id: 'fund', toolName: 'get_financials', result: { data: { revenue: 12 } } }),
        call({ id: 'history', toolName: 'get_kline', result: { data: [{ close: 9, timestamp: 10 }] } }),
      ],
    });
    expect(records.map((record) => record.kind)).toEqual(['fundamental', 'historical']);
  });

  it('removes secret-shaped query and result fields before persistence', () => {
    const [record] = buildFinancialEvidence({
      sessionId: 's',
      runId: 'r',
      toolCalls: [call({ result: { data: { lastPrice: 1, authorization: 'canary-secret' } } })],
    });
    expect(JSON.stringify(record)).not.toContain('canary-secret');
    expect(record.query).toEqual({ symbol: 'aapl.us' });
  });

  it('exports machine-readable evidence for claim verification without secrets', () => {
    const evidence = buildFinancialEvidence({ sessionId: 's', runId: 'r', toolCalls: [call()] });
    expect(isFinancialEvidenceEnvelope(evidence[0])).toBe(true);
    const exported = financialEvidenceToJson(evidence);
    expect(JSON.parse(exported).schemaVersion).toBe('financial-evidence/v1');
    expect(exported).not.toContain('canary-secret');
  });

  it('matches computeEnvelopeId so citations can be issued before settle (#30)', () => {
    const [record] = buildFinancialEvidence({ sessionId: 's', runId: 'r', toolCalls: [call()] });
    expect(record.id).toBe(computeEnvelopeId('r', record.toolCallId, record.resultHash));
    expect(record.id.startsWith('fe_')).toBe(true);
    expect(computeEnvelopeId('r', 'call-1', record.resultHash)).toBe(computeEnvelopeId('r', 'call-1', record.resultHash));
  });
});

describe('asOf unit normalization (issue #181)', () => {
  it('normalizes seconds payloads from the inferAsOf fallback into epoch ms', () => {
    // company.* capabilities carry no provenance.marketTime; their payload
    // timestamps are epoch SECONDS (longbridge parser toEpochSeconds).
    const tool = call({
      id: 'call-fallback',
      toolName: 'get_company_profile',
      result: {
        data: { symbol: 'AAPL.US', name: 'Apple', timestamp: 1710000000 },
        provenance: { providerId: 'longbridge', fetchedAt: 120, stale: false },
      },
    });
    const envelope = buildFinancialEvidence({ sessionId: 's', runId: 'r', toolCalls: [tool] })[0];
    expect(envelope.asOf).toBe(1710000000_000);
    expect(envelope.asOf! > 1e12).toBe(true);
  });

  it('normalizes seconds captured by isTimeMetric into epoch ms', () => {
    // Rating-style payloads carry epoch-SECONDS `date` fields matching the
    // isTimeMetric suffixes; the emitted value-level asOf must be ms.
    const tool = call({
      id: 'call-values',
      toolName: 'get_valuation',
      result: {
        data: { symbol: 'AAPL.US', pe: 31.2, items: [{ date: 1710000000, value: 4.5 }] },
        provenance: { providerId: 'longbridge', fetchedAt: 120, marketTime: 1710000000_000, stale: false },
      },
    });
    const envelope = buildFinancialEvidence({ sessionId: 's', runId: 'r', toolCalls: [tool] })[0];
    const valueAsOf = envelope.values.find((v) => v.metric.endsWith('.date'))?.asOf;
    expect(valueAsOf).toBe(1710000000_000);
    expect(valueAsOf! > 1e12).toBe(true);
    // Envelope-level primary path (marketTime passthrough) stays untouched.
    expect(envelope.asOf).toBe(1710000000_000);
  });

  it('does not double-scale already-ms inputs', () => {
    const tool = call({
      id: 'call-ms',
      toolName: 'get_company_profile',
      result: {
        data: { symbol: 'AAPL.US', name: 'Apple', timestamp: 1710000000_000 },
        provenance: { providerId: 'massive', fetchedAt: 120, stale: false },
      },
    });
    const envelope = buildFinancialEvidence({ sessionId: 's', runId: 'r', toolCalls: [tool] })[0];
    expect(envelope.asOf).toBe(1710000000_000);
  });

  it('keeps the marketTime primary path byte-identical', () => {
    const tool = call();
    const envelope = buildFinancialEvidence({ sessionId: 'session-1', runId: 'run-1', toolCalls: [tool] })[0];
    expect(envelope.asOf).toBe(110);
  });
});
