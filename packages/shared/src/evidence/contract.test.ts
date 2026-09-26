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

  it('keeps observations with different units or currencies distinct in a bundle', () => {
    const values = [
      { metric: 'revenue', originalValue: 100, normalizedValue: 100, unit: 'million', currency: 'USD' },
      { metric: 'revenue', originalValue: 100, normalizedValue: 100, unit: 'million', currency: 'EUR' },
      { metric: 'revenue', originalValue: 100, normalizedValue: 100, unit: 'billion', currency: 'USD' },
      { metric: 'revenue', originalValue: 100, normalizedValue: 100, unit: 'a|b', currency: 'c' },
      { metric: 'revenue', originalValue: 100, normalizedValue: 100, unit: 'a', currency: 'b|c' },
    ];
    const bundle = buildEvidenceBundle(projectFinancialEvidence([envelope({ values })]));
    expect(bundle.evidence).toHaveLength(5);
    expect(new Set(bundle.evidence.map((item) => item.evidenceId)).size).toBe(5);
  });

  it('separates claim statements and instrument scopes containing delimiters', () => {
    const projection = projectEvidenceRefs([
      { capabilityId: 'market.quote', runId: 'run-1', claim: 'a|b', fetchedAt: 1000, summary: 'first', instrumentId: 'c' },
      { capabilityId: 'market.quote', runId: 'run-1', claim: 'a', fetchedAt: 1000, summary: 'second', instrumentId: 'b|c' },
    ]);
    expect(projection.claims[0]!.claimId).not.toBe(projection.claims[1]!.claimId);
  });

  it('keeps ids stable across serialize → parse round-trips', () => {
    const financial = projectFinancialEvidence([envelope()]);
    const refs = projectEvidenceRefs([
      { capabilityId: 'market.quote', runId: 'run-1', claim: 'AAPL trades above 200', fetchedAt: 1000, summary: 'lastPrice 210.5', instrumentId: 'AAPL.US' },
    ]);
    const newsProjection = projectNewsItems([news()], { retrievedAt: 2500 });
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

  it('unifies resolved asOf between financial semantics and freshness, honoring value.asOf over envelope.asOf', () => {
    const env = envelope({
      asOf: 900,
      values: [
        { metric: 'granular', originalValue: 1, normalizedValue: 1, asOf: 950 },
        { metric: 'fallback-to-envelope', originalValue: 2, normalizedValue: 2 },
      ],
    });
    const { evidence } = projectFinancialEvidence([env]);
    expect(evidence[0]!.financial?.asOf).toBe(950);
    expect(evidence[0]!.freshness.asOf).toBe(950);

    expect(evidence[1]!.financial?.asOf).toBe(900);
    expect(evidence[1]!.freshness.asOf).toBe(900);
  });

  it('handles value.asOf present when envelope.asOf is undefined', () => {
    const env = envelope({
      asOf: undefined,
      values: [{ metric: 'standalone', originalValue: 1, normalizedValue: 1, asOf: 999 }],
    });
    const { evidence } = projectFinancialEvidence([env]);
    expect(evidence[0]!.financial?.asOf).toBe(999);
    expect(evidence[0]!.freshness.asOf).toBe(999);
  });

  it('never fabricates canonical URLs for structured finance sources', () => {
    const { sources } = projectFinancialEvidence([envelope()]);
    expect(sources[0]!.canonicalUrl).toBeUndefined();
  });

  it('preserves document semantics for news sources and converts seconds to ms without forging retrievedAt', () => {
    const item = news({ timestamp: 1726000000 }); // epoch seconds
    const { sources, evidence } = projectNewsItems([item], { retrievedAt: 1726005000000 });
    expect(sources[0]!.kind).toBe('news');
    expect(sources[0]!.canonicalUrl).toBe('https://example.com/apple-record-quarter?utm_source=x');
    // Seconds to milliseconds conversion: 1726000000 s -> 1726000000000 ms
    expect(sources[0]!.publishedAt).toBe(1726000000000);
    expect(sources[0]!.retrievedAt).toBe(1726005000000);
    expect(evidence[0]!.kind).toBe('text_excerpt');
    expect(evidence[0]!.excerpt?.text).toBe('Apple reported revenue above consensus.');
    expect(evidence[0]!.freshness.retrievedAt).toBe(1726005000000);
    expect(evidence[0]!.freshness.asOf).toBe(1726000000000);
    expect(evidence[0]!.provenance.instrumentId).toBe('AAPL.US');
  });

  it('skips news items without excerpt text without leaving orphan sources', () => {
    const projection = projectNewsItems([news({ title: '', summary: '' })], { retrievedAt: 2500 });
    expect(projection.sources).toHaveLength(0);
    expect(projection.evidence).toHaveLength(0);
  });

  it('preserves explicit epoch-zero retrieval time without substituting projection time', () => {
    const { sources, evidence } = projectNewsItems([news({ timestamp: 1 })], { retrievedAt: 0 });
    expect(sources[0]!.publishedAt).toBe(1000);
    expect(sources[0]!.retrievedAt).toBe(0);
    expect(evidence[0]!.freshness.retrievedAt).toBe(0);
  });

  it('requires retrieval metadata instead of inventing it during projection', () => {
    // @ts-expect-error Retrieval time must come from the caller.
    expect(() => projectNewsItems([news()])).toThrow();
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
    const newsProjection = projectNewsItems([news()], { retrievedAt: 2500 });
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
