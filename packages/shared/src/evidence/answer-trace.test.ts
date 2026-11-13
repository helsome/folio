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

describe('buildAnswerEvidenceTrace fence boundaries', () => {
  const body = (id: string) => JSON.stringify({
    version: 1,
    type: 'metric_grid',
    metrics: [{ label: 'Last', value: 210.5, unit: 'price', currency: 'USD' }],
    evidenceIds: [id],
  });
  const example = body('fe_example');
  const live = body('fe_env1');
  const liveBlock = ['```folio-block', live, '```'].join('\n');

  // Mirror parseAnswerSegments.fences.test.ts with valid cited payloads so
  // literal examples cannot pass merely because their JSON is invalid.
  const cases: { name: string; answer: string; ids: string[] }[] = [
    {
      name: 'keeps typed examples inside ordinary backtick fences opaque',
      answer: ['```json', '```folio-block', example, '```', '```', 'After'].join('\n'),
      ids: [],
    },
    {
      name: 'keeps typed examples inside ordinary tilde fences opaque',
      answer: ['~~~markdown', '~~~folio-block', example, '~~~', '~~~', 'After'].join('\n'),
      ids: [],
    },
    {
      name: 'requires the same closing marker and at least the opening length',
      answer: ['````folio-block', example, '```', '~~~', '````', liveBlock].join('\n'),
      ids: ['fe_env1'],
    },
    {
      name: 'accepts a longer matching closing fence',
      answer: ['```folio-block', live, '````', 'After'].join('\n'),
      ids: ['fe_env1'],
    },
    {
      name: 'supports CRLF delimiters and preserves the original answer',
      answer: ['Before', '```folio-block', live, '```', 'After'].join('\r\n'),
      ids: ['fe_env1'],
    },
    {
      name: 'accepts three spaces but not four before a fence',
      answer: ['   ```folio-block', live, '   ```', '    ```folio-block', example, '    ```'].join('\n'),
      ids: ['fe_env1'],
    },
    {
      name: 'keeps an unclosed ordinary fence opaque',
      answer: ['```ts', 'const example = true;', '```folio-block', example].join('\n'),
      ids: [],
    },
    {
      name: 'resumes typed parsing after a closed ordinary fence',
      answer: ['Before', '```json', '```folio-block', example, '```', liveBlock, 'After'].join('\n'),
      ids: ['fe_env1'],
    },
    {
      name: 'ignores inline and invalid-info backticks before a live block',
      answer: ['Text ```folio-block', example, '```folio-block`', liveBlock].join('\n'),
      ids: ['fe_env1'],
    },
    {
      name: 'does not close a tilde block at backticks or an incomplete marker',
      answer: ['~~~folio-block', example, '```', '~~', '~~~', liveBlock].join('\n'),
      ids: ['fe_env1'],
    },
    {
      name: 'accepts a valid tilde block',
      answer: ['~~~folio-block', live, '~~~'].join('\n'),
      ids: ['fe_env1'],
    },
    {
      name: 'accepts a valid longer backtick block',
      answer: ['````folio-block', live, '`````'].join('\n'),
      ids: ['fe_env1'],
    },
    {
      name: 'keeps examples inside longer ordinary fences opaque',
      answer: ['````markdown', '```folio-block', example, '```', '````', liveBlock].join('\n'),
      ids: ['fe_env1'],
    },
    {
      name: 'omits valid JSON in an unclosed typed fence',
      answer: ['~~~folio-block', live].join('\n'),
      ids: [],
    },
    {
      name: 'does not close a longer typed fence at a shorter marker',
      answer: ['````folio-block', live, '```'].join('\n'),
      ids: [],
    },
    {
      name: 'preserves citation order across fence styles and literal examples',
      answer: [liveBlock, '````markdown', '```folio-block', example, '```', '````',
        '~~~folio-block', body('fe_env2'), '~~~'].join('\n'),
      ids: ['fe_env1', 'fe_env2'],
    },
  ];

  for (const { name, answer, ids } of cases) {
    it(name, () => {
      const trace = buildAnswerEvidenceTrace({
        sessionId: 'session-1',
        runId: 'run-1',
        question: 'q',
        answer,
        financialEvidence: [envelope('fe_env1'), envelope('fe_env2', { asOf: 800 })],
      });

      expect(trace.answer).toBe(answer);
      expect(trace.citations).toEqual(ids.map((id, blockIndex) => ({
        blockIndex,
        blockType: 'metric_grid',
        citedEvidenceIds: [id],
        mappedEvidenceIds: trace.bundle.evidence
          .filter((item) => item.provenance.envelopeId === id)
          .map((item) => item.evidenceId),
        unmappedEvidenceIds: [],
      })));
    });
  }
});
