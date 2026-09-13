import { describe, expect, it } from 'bun:test';
import type {
  FinancialEvidenceEnvelope,
  NewsItem,
} from '@finagent/core';
import {
  buildEvidenceBundle,
  isEvidenceBundle,
  parseEvidenceBundle,
  projectEvidenceRefs,
  projectFinancialEvidence,
  projectNewsItems,
  projectTextEvidence,
  serializeEvidenceBundle,
} from './contract.ts';

function envelope(overrides: Partial<FinancialEvidenceEnvelope> = {}): FinancialEvidenceEnvelope {
  return {
    schemaVersion: 'financial-evidence/v1',
    normalizationVersion: 'folio-normalization/v1',
    id: 'fe_abc123',
    sessionId: 'session-1',
    runId: 'run-1',
    toolCallId: 'call-1',
    toolName: 'get_quote',
    kind: 'quote',
    instrumentId: 'AAPL.US',
    capabilityId: 'market.quote',
    provider: 'longbridge',
    query: { symbol: 'AAPL.US' },
    values: [
      { metric: 'lastPrice', originalValue: '210.50', normalizedValue: 210.5, currency: 'USD', unit: 'price' },
    ],
    retrievedAt: 1000,
    asOf: 900,
    stale: false,
    cacheHit: false,
    resultSnapshot: { lastPrice: 210.5 },
    resultHash: 'sha256:abc',
    lineage: [{ kind: 'provider', description: 'Retrieved market.quote from longbridge.' }],
    ...overrides,
  };
}

function news(overrides: Partial<NewsItem> = {}): NewsItem {
  return {
    id: 'news-1',
    title: 'Apple announces record quarter',
    summary: 'Apple reported revenue above consensus.',
    url: 'https://example.com/apple-record-quarter?utm_source=x',
    timestamp: 2000,
    symbols: ['AAPL.US'],
    instrumentId: 'AAPL.US',
    ...overrides,
  };
}

describe('evidence contract identity', () => {
  it('derives identical ids for identical inputs and distinct ids for different inputs', () => {
    const first = projectFinancialEvidence([envelope()]);
    const second = projectFinancialEvidence([envelope()]);
    expect(second.sources[0]!.sourceId).toBe(first.sources[0]!.sourceId);
    expect(second.evidence[0]!.evidenceId).toBe(first.evidence[0]!.evidenceId);

    const changed = projectFinancialEvidence([envelope({ values: [{ metric: 'lastPrice', originalValue: '211.00', normalizedValue: 211 }] })]);
    expect(changed.evidence[0]!.evidenceId).not.toBe(first.evidence[0]!.evidenceId);
    // Same source query → same source even when the observed value changed.
    expect(changed.sources[0]!.sourceId).toBe(first.sources[0]!.sourceId);
  });

  it('derives source ids independent of query key order', () => {
    const a = projectFinancialEvidence([envelope({ query: { symbol: 'AAPL.US', period: 'q2' } })]);
    const b = projectFinancialEvidence([envelope({ query: { period: 'q2', symbol: 'AAPL.US' } })]);
    expect(b.sources[0]!.sourceId).toBe(a.sources[0]!.sourceId);
  });

  it('keeps ids stable across serialize → parse round-trips', () => {
    const financial = projectFinancialEvidence([envelope()]);
    const refs = projectEvidenceRefs([
      { capabilityId: 'market.quote', runId: 'run-1', claim: 'AAPL trades above 200', fetchedAt: 1000, summary: 'lastPrice 210.5', instrumentId: 'AAPL.US' },
    ]);
    const newsProjection = projectNewsItems([news()]);
    const bundle = buildEvidenceBundle(financial, refs, newsProjection);

    const roundTripped = parseEvidenceBundle(serializeEvidenceBundle(bundle));
    expect(roundTripped).toBeDefined();
    expect(roundTripped).toEqual(bundle);
  });

  it('rejects payloads with unknown schema versions', () => {
    expect(parseEvidenceBundle(JSON.stringify({ schemaVersion: 'folio-evidence-contract/v0', sources: [], evidence: [], claims: [] }))).toBeUndefined();
    expect(parseEvidenceBundle('not json')).toBeUndefined();
    expect(isEvidenceBundle({ schemaVersion: 'folio-evidence-contract/v1', sources: [], evidence: [], claims: [] })).toBe(true);
    expect(isEvidenceBundle({ schemaVersion: 'other/v1' })).toBe(false);
  });
});

describe('evidence contract projections', () => {
  it('preserves financial semantics in structured_value evidence', () => {
    const { sources, evidence } = projectFinancialEvidence([envelope()]);
    expect(sources).toHaveLength(1);
    expect(sources[0]!.kind).toBe('structured_finance');
    expect(sources[0]!.publisher).toBe('longbridge');
    const item = evidence[0]!;
    expect(item.kind).toBe('structured_value');
    expect(item.financial).toMatchObject({
      instrumentId: 'AAPL.US',
      metric: 'lastPrice',
      value: 210.5,
      originalValue: '210.50',
      unit: 'price',
      currency: 'USD',
    });
    expect(item.freshness).toEqual({ retrievedAt: 1000, asOf: 900, stale: false });
    expect(item.provenance).toMatchObject({ runId: 'run-1', toolCallId: 'call-1', capabilityId: 'market.quote', provider: 'longbridge' });
  });

  it('never fabricates canonical URLs for structured finance sources', () => {
    const { sources } = projectFinancialEvidence([envelope()]);
    expect(sources[0]!.canonicalUrl).toBeUndefined();
  });

  it('preserves document semantics for news sources', () => {
    const { sources, evidence } = projectNewsItems([news()]);
    expect(sources[0]!.kind).toBe('news');
    expect(sources[0]!.canonicalUrl).toBe('https://example.com/apple-record-quarter?utm_source=x');
    expect(evidence[0]!.kind).toBe('text_excerpt');
    expect(evidence[0]!.excerpt?.text).toBe('Apple reported revenue above consensus.');
    expect(evidence[0]!.provenance.instrumentId).toBe('AAPL.US');
  });

  it('preserves excerpt location for filing-style document evidence', () => {
    const { sources, evidence } = projectTextEvidence({
      kind: 'filing',
      url: 'https://www.sec.gov/archives/abc-10q.htm',
      publisher: 'sec.gov',
      text: 'Revenue increased 12% year over year.',
      location: 'paragraph.7',
      retrievedAt: 3000,
      publishedAt: 2500,
      authority: { primary: true, sourceClass: 'regulator' },
      instrumentId: 'AAPL.US',
    });
    expect(sources[0]!.kind).toBe('filing');
    expect(sources[0]!.authority).toEqual({ primary: true, sourceClass: 'regulator' });
    expect(evidence[0]!.excerpt).toEqual({ text: 'Revenue increased 12% year over year.', location: 'paragraph.7' });
  });

  it('splits EvidenceRef into claim + tool_result evidence without mutating inputs', () => {
    const refs = [
      { capabilityId: 'market.quote', runId: 'run-1', claim: 'AAPL trades above 200', fetchedAt: 1000, summary: 'lastPrice 210.5', instrumentId: 'AAPL.US' },
    ];
    const frozen = JSON.parse(JSON.stringify(refs));
    const { sources, evidence, claims } = projectEvidenceRefs(refs);
    expect(refs).toEqual(frozen);
    expect(claims[0]!.statement).toBe('AAPL trades above 200');
    expect(claims[0]!.verification).toBe('unverified');
    expect(evidence[0]!.kind).toBe('tool_result');
    expect(sources[0]!.kind).toBe('tool');
    expect(claims[0]!.evidenceIds).toEqual([evidence[0]!.evidenceId]);
  });
});

describe('evidence bundle many-to-many mapping', () => {
  it('merges identical claims across runs and unions their evidence', () => {
    const runOne = projectEvidenceRefs([
      { capabilityId: 'market.quote', runId: 'run-1', claim: 'AAPL valuation is expensive', fetchedAt: 1000, summary: 'pe 35' },
    ]);
    const runTwo = projectEvidenceRefs([
      { capabilityId: 'company.valuation', runId: 'run-2', claim: 'AAPL valuation is expensive', fetchedAt: 5000, summary: 'pe 36' },
    ]);
    const bundle = buildEvidenceBundle(runOne, runTwo);

    expect(bundle.claims).toHaveLength(1);
    expect(bundle.claims[0]!.evidenceIds).toHaveLength(2);
    expect(bundle.evidence).toHaveLength(2);
    for (const evidenceId of bundle.claims[0]!.evidenceIds) {
      expect(bundle.evidence.some((item) => item.evidenceId === evidenceId)).toBe(true);
    }
  });

  it('lets one evidence item back multiple claims', () => {
    const financial = projectFinancialEvidence([envelope()]);
    const sharedEvidenceId = financial.evidence[0]!.evidenceId;
    const bundle = buildEvidenceBundle(financial, {
      claims: [
        { claimId: 'claim_a', statement: 'AAPL trades above 200', evidenceIds: [sharedEvidenceId], verification: 'unverified' },
        { claimId: 'claim_b', statement: 'AAPL price is fresh', evidenceIds: [sharedEvidenceId], verification: 'unverified' },
      ],
    });
    expect(bundle.claims).toHaveLength(2);
    for (const claim of bundle.claims) {
      expect(claim.evidenceIds).toEqual([sharedEvidenceId]);
    }
  });

  it('dedupes sources and evidence by id while preserving insertion order', () => {
    const financial = projectFinancialEvidence([envelope()]);
    const sameSource = projectFinancialEvidence([envelope()]);
    const bundle = buildEvidenceBundle(financial, sameSource);
    expect(bundle.sources).toHaveLength(1);
    expect(bundle.evidence).toHaveLength(1);
  });
});

describe('evidence bundle mixed-source integration', () => {
  // Acceptance: one bundle/report carrying structured finance evidence and
  // text evidence side by side, reloadable from persistence.
  it('builds a mixed bundle with financial, tool-claim and news evidence that survives reload', () => {
    const financial = projectFinancialEvidence([envelope()]);
    const refs = projectEvidenceRefs([
      { capabilityId: 'market.quote', runId: 'run-1', claim: 'AAPL trades above 200', fetchedAt: 1000, summary: 'lastPrice 210.5', instrumentId: 'AAPL.US' },
    ]);
    const newsProjection = projectNewsItems([news()]);
    const filing = projectTextEvidence({
      kind: 'filing',
      url: 'https://www.sec.gov/archives/abc-10q.htm',
      publisher: 'sec.gov',
      text: 'Revenue increased 12% year over year.',
      location: 'paragraph.7',
      retrievedAt: 3000,
      authority: { primary: true, sourceClass: 'regulator' },
      instrumentId: 'AAPL.US',
    });
    const bundle = buildEvidenceBundle(financial, refs, newsProjection, filing);

    expect(bundle.schemaVersion).toBe('folio-evidence-contract/v1');
    expect(bundle.sources.map((source) => source.kind)).toEqual(['structured_finance', 'tool', 'news', 'filing']);
    expect(bundle.evidence.some((item) => item.kind === 'structured_value')).toBe(true);
    expect(bundle.evidence.some((item) => item.kind === 'text_excerpt' && item.excerpt?.location === 'paragraph.7')).toBe(true);
    // Sources with identical identity dedupe; a later observation of the same
    // query is a NEW evidence item (retrieval time is part of evidence identity).
    const refetched = buildEvidenceBundle(bundle, projectFinancialEvidence([envelope({ retrievedAt: 9000, values: [{ metric: 'lastPrice', originalValue: '211.00', normalizedValue: 211 }] })]));
    expect(refetched.sources).toHaveLength(4);
    expect(refetched.evidence).toHaveLength(5);

    const reloaded = parseEvidenceBundle(serializeEvidenceBundle(bundle));
    expect(reloaded).toEqual(bundle);
    expect(isEvidenceBundle(reloaded)).toBe(true);
  });
});
