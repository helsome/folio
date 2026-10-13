import { describe, expect, it } from 'bun:test';
import type { FinancialEvidenceEnvelope } from '@finagent/core';
import { ANSWER_TRACE_SCHEMA_VERSION, buildAnswerEvidenceTrace } from './answer-trace.ts';
import { buildEvidenceBundle, projectFinancialEvidence } from './contract.ts';

function envelope(id: string, overrides: Partial<FinancialEvidenceEnvelope> = {}): FinancialEvidenceEnvelope {
  return {
    schemaVersion: 'financial-evidence/v1',
    normalizationVersion: 'folio-normalization/v1',
    id,
    sessionId: 'session-1',
    runId: 'run-1',
    toolCallId: `call-${id}`,
    toolName: 'get_quote',
    kind: 'quote',
    instrumentId: 'NVDA.US',
    capabilityId: 'market.quote',
    provider: 'longbridge',
    query: { symbol: 'NVDA.US' },
    values: [{ metric: 'lastPrice', originalValue: '210.50', normalizedValue: 210.5, currency: 'USD' }],
    retrievedAt: 1000,
    asOf: 900,
    stale: false,
    cacheHit: false,
    resultSnapshot: { lastPrice: 210.5 },
    resultHash: 'sha256:abc',
    lineage: [],
    ...overrides,
  };
}

const METRIC_BLOCK = [
  '```folio-block',
  JSON.stringify({
    version: 1,
    type: 'metric_grid',
    title: 'NVDA quote',
    metrics: [{ label: 'Last', value: 210.5, unit: 'price', currency: 'USD', evidenceIds: ['fe_env1'] }],
    evidenceIds: ['fe_env1', 'fe_missing'],
  }),
  '```',
].join('\n');

const ANSWER = `Intro paragraph referencing the data.

\`\`\`json
{"type":"metric_grid","note":"plain code fence stays text"}
\`\`\`

${METRIC_BLOCK}`;

describe('buildAnswerEvidenceTrace', () => {
  it('maps block citations to contract evidence and records explicit gaps', () => {
    const trace = buildAnswerEvidenceTrace({
      sessionId: 'session-1',
      runId: 'run-1',
      question: 'What is NVDA trading at?',
      answer: ANSWER,
      financialEvidence: [envelope('fe_env1')],
    });

    expect(trace.schemaVersion).toBe(ANSWER_TRACE_SCHEMA_VERSION);
    expect(trace.question).toBe('What is NVDA trading at?');
    expect(trace.citations).toHaveLength(1);
    const citation = trace.citations[0]!;
    expect(citation.blockType).toBe('metric_grid');
    expect(citation.citedEvidenceIds).toEqual(['fe_env1', 'fe_missing']);
    expect(citation.unmappedEvidenceIds).toEqual(['fe_missing']);
    expect(citation.mappedEvidenceIds.length).toBeGreaterThan(0);
    for (const evidenceId of citation.mappedEvidenceIds) {
      const item = trace.bundle.evidence.find((candidate) => candidate.evidenceId === evidenceId);
      expect(item?.provenance.envelopeId).toBe('fe_env1');
    }
  });

  it('builds the bundle from the turn envelopes with structured_finance sources', () => {
    const trace = buildAnswerEvidenceTrace({
      sessionId: 'session-1',
      runId: 'run-1',
      question: 'q',
      answer: ANSWER,
      financialEvidence: [envelope('fe_env1'), envelope('fe_env2', { toolName: 'get_financials', kind: 'fundamental', capabilityId: 'company.financials' })],
    });
    const expected = buildEvidenceBundle(projectFinancialEvidence([
      envelope('fe_env1'),
      envelope('fe_env2', { toolName: 'get_financials', kind: 'fundamental', capabilityId: 'company.financials' }),
    ]));
    expect(trace.bundle).toEqual(expected);
    expect(trace.bundle.sources.every((source) => source.kind === 'structured_finance' && source.canonicalUrl === undefined)).toBe(true);
  });

  it('is deterministic for identical turns', () => {
    const input = {
      sessionId: 'session-1',
      runId: 'run-1',
      question: 'q',
      answer: ANSWER,
      financialEvidence: [envelope('fe_env1')],
    };
    expect(buildAnswerEvidenceTrace(input)).toEqual(buildAnswerEvidenceTrace(input));
  });

  it('reports a citation with an empty mapping when the turn has no envelopes', () => {
    const trace = buildAnswerEvidenceTrace({
      sessionId: 'session-1',
      runId: 'run-1',
      question: 'q',
      answer: ANSWER,
      financialEvidence: [],
    });
    expect(trace.bundle.evidence).toHaveLength(0);
    expect(trace.citations[0]!.mappedEvidenceIds).toEqual([]);
    expect(trace.citations[0]!.unmappedEvidenceIds).toEqual(['fe_env1', 'fe_missing']);
  });

  it('ignores unclosed fences and invalid block payloads', () => {
    const streaming = 'Partial answer\n\n```folio-block\n{"version":1,"type":"metric_grid"';
    const unclosed = buildAnswerEvidenceTrace({
      sessionId: 'session-1',
      runId: 'run-1',
      question: 'q',
      answer: streaming,
      financialEvidence: [envelope('fe_env1')],
    });
    expect(unclosed.citations).toHaveLength(0);

    const invalid = `Bad block.\n\n\`\`\`folio-block\n{"nope":true}\n\`\`\``;
    const invalidTrace = buildAnswerEvidenceTrace({
      sessionId: 'session-1',
      runId: 'run-1',
      question: 'q',
      answer: invalid,
      financialEvidence: [envelope('fe_env1')],
    });
    expect(invalidTrace.citations).toHaveLength(0);
  });
});
