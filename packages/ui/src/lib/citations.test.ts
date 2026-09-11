import { describe, expect, it } from 'bun:test';
import type { Message } from '@finagent/core';
import { assignCitationNumbers, collectBlockEvidenceIds, collectCitationSources } from './citations';
import type { FinancialEvidenceEnvelope } from '@finagent/core';

function envelope(overrides: Partial<FinancialEvidenceEnvelope> = {}): FinancialEvidenceEnvelope {
  return {
    schemaVersion: 'financial-evidence/v1',
    normalizationVersion: 'folio-normalization/v1',
    id: 'fe_abc123',
    sessionId: 's',
    runId: 'r',
    toolCallId: 'get_quote-1',
    toolName: 'get_quote',
    kind: 'quote',
    capabilityId: 'market.quote',
    provider: 'longbridge',
    query: {},
    values: [{ metric: 'lastPrice', originalValue: 182.31, normalizedValue: 182.31, currency: 'USD' }],
    retrievedAt: 1700000000000,
    stale: false,
    cacheHit: false,
    resultSnapshot: {},
    resultHash: 'sha256:deadbeef',
    lineage: [{ kind: 'provider', description: 'Retrieved market.quote from longbridge.' }],
    ...overrides,
  };
}

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    role: 'assistant',
    content: '',
    timestamp: 0,
    ...overrides,
  };
}

describe('collectCitationSources', () => {
  it('joins tool calls to evidence envelopes by toolCallId', () => {
    const index = collectCitationSources(message({
      toolCalls: [{ id: 'get_quote-1', toolName: 'get_quote', args: { symbol: 'aapl.us' }, startedAt: 1, completedAt: 2, status: 'success' }],
      financialEvidence: [envelope()],
    }));
    expect(index.sources).toHaveLength(1);
    const source = index.sources[0];
    expect(source?.id).toBe('get_quote-1');
    expect(source?.envelopeId).toBe('fe_abc123');
    expect(source?.kind).toBe('financial');
    expect(source?.provider).toBe('longbridge');
    expect(source?.stale).toBe(false);
    expect(source?.title).toContain('182.31');
  });

  it('maps non-financial successful tool calls to fallback kinds', () => {
    const index = collectCitationSources(message({
      toolCalls: [
        { id: 'get_news-1', toolName: 'get_news', args: {}, startedAt: 1, status: 'success', result: { data: [{ url: 'https://example.com/a', title: 'Headline' }] } },
        { id: 'get_other-1', toolName: 'get_other', args: {}, startedAt: 1, status: 'success' },
      ],
    }));
    expect(index.byId.get('get_news-1')?.kind).toBe('news');
    expect(index.byId.get('get_news-1')?.url).toBe('https://example.com/a');
    expect(index.byId.get('get_other-1')?.kind).toBe('tool');
  });

  it('skips errored tool calls — failed calls are not citable origins', () => {
    const index = collectCitationSources(message({
      toolCalls: [{ id: 'get_quote-err', toolName: 'get_quote', args: {}, startedAt: 1, status: 'error' }],
    }));
    expect(index.sources).toHaveLength(0);
  });
});

describe('assignCitationNumbers', () => {
  const block = {
    version: 1,
    type: 'metric_grid' as const,
    metrics: [],
    evidenceIds: ['block-only-1'],
  };

  it('numbers inline markers by first appearance, then block-only ids', () => {
    const numbers = assignCitationNumbers(['b-2', 'a-1', 'b-2'], [block]);
    expect(numbers.get('b-2')).toBe(1);
    expect(numbers.get('a-1')).toBe(2);
    expect(numbers.get('block-only-1')).toBe(3);
  });

  it('shares numbers when an id appears both inline and in a block', () => {
    const numbers = assignCitationNumbers(['shared-1'], [block, { ...block, evidenceIds: ['shared-1'] }]);
    expect(numbers.get('shared-1')).toBe(1);
    expect(numbers.get('block-only-1')).toBe(2);
  });
});

describe('collectBlockEvidenceIds', () => {
  it('deduplicates base and per-metric ids in order', () => {
    const ids = collectBlockEvidenceIds({
      version: 1,
      type: 'metric_grid',
      evidenceIds: ['a-1', 'b-2'],
      metrics: [
        { label: 'Last', value: 1, unit: 'count', evidenceIds: ['b-2', 'c-3'] },
        { label: 'Vol', value: 2, unit: 'count' },
      ],
    });
    expect(ids).toEqual(['a-1', 'b-2', 'c-3']);
  });
});
