import { describe, expect, it } from 'bun:test';
import {
  RETRIEVAL_RANKING_POLICY_VERSION,
  canonicalizeSourceUrl,
  normalizeSourceTitle,
  rankRetrievalSources,
  type RetrievalSourceInput,
} from './ranking.ts';

const NOW = Date.UTC(2026, 8, 11);

function source(
  id: string,
  url: string,
  title: string,
  excerpt?: string,
  publishedAt = NOW - 3_600_000
): RetrievalSourceInput {
  return { id, url, title, excerpt, publishedAt, available: true };
}

describe('canonicalizeSourceUrl', () => {
  it('removes tracking and fragments and sorts meaningful parameters', () => {
    expect(
      canonicalizeSourceUrl(
        'HTTPS://WWW.Example.com/story/?utm_source=x&b=2&a=1#comments'
      )
    ).toBe('https://example.com/story?a=1&b=2');
  });

  it('keeps malformed input stable instead of throwing', () => {
    expect(canonicalizeSourceUrl(' not a url ')).toBe('not a url');
  });
});

describe('normalizeSourceTitle', () => {
  it('normalizes case, punctuation, unicode width and whitespace', () => {
    expect(normalizeSourceTitle('ＮＶＩＤＩＡ：  Earnings—Beat!')).toBe(
      'nvidia earnings beat'
    );
  });
});

describe('rankRetrievalSources', () => {
  it('clusters tracking variants as one independent source', () => {
    const result = rankRetrievalSources(
      [
        source('a', 'https://example.com/news?id=1&utm_source=feed', 'Result A'),
        source('b', 'https://www.example.com/news?id=1#top', 'Result A copied'),
      ],
      { now: NOW }
    );
    expect(result.clusters).toHaveLength(1);
    expect(result.independentSourceCount).toBe(1);
    expect(result.dropped[0].decisionReason).toBe('duplicate_of:a');
    expect(result.clusters[0].duplicateRelations).toEqual([
      { sourceId: 'b', relation: 'same_url' },
    ]);
  });

  it('clusters exact content copies published under different URLs', () => {
    const result = rankRetrievalSources(
      [
        source('wire', 'https://wire.test/a', 'Company announces results', 'Revenue rose 20 percent.'),
        source('copy', 'https://copy.test/b', 'Results update', 'Revenue rose 20 percent.'),
      ],
      { now: NOW }
    );
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].duplicateRelations[0].relation).toBe(
      'same_content'
    );
  });

  it('clusters near-duplicate syndicated excerpts', () => {
    const result = rankRetrievalSources(
      [
        source(
          'wire',
          'https://wire.test/a',
          'Chipmaker raises outlook',
          'The chipmaker raised its annual revenue outlook after strong demand for data center products'
        ),
        source(
          'copy',
          'https://copy.test/b',
          'Chipmaker lifts forecast',
          'After strong demand for data center products the chipmaker raised its annual revenue outlook'
        ),
      ],
      { now: NOW, nearDuplicateThreshold: 0.75 }
    );
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].duplicateRelations[0].relation).toBe(
      'near_duplicate'
    );
  });

  it('does not merge same-title reports from different periods', () => {
    const result = rankRetrievalSources(
      [
        source(
          'q1',
          'https://issuer.test/q1',
          'Quarterly earnings release',
          undefined,
          Date.UTC(2025, 0, 1)
        ),
        source(
          'q2',
          'https://issuer.test/q2',
          'Quarterly earnings release',
          undefined,
          Date.UTC(2025, 3, 1)
        ),
      ],
      { now: NOW }
    );
    expect(result.clusters).toHaveLength(2);
    expect(result.independentSourceCount).toBe(2);
  });

  it('prefers primary sources in a relevant financial query', () => {
    const result = rankRetrievalSources(
      [
        source('blog', 'https://random-blog.test/post', 'NVIDIA files quarterly results'),
        source(
          'filing',
          'https://www.sec.gov/Archives/edgar/data/1/report',
          'NVIDIA quarterly results filing'
        ),
        source('news', 'https://www.reuters.com/technology/report', 'NVIDIA quarterly results'),
      ],
      { now: NOW, query: 'NVIDIA quarterly results', topK: 3 }
    );
    expect(result.selected.map((item) => item.source.id)).toEqual([
      'filing',
      'news',
      'blog',
    ]);
    expect(result.selected[0].sourceClass).toBe('regulator');
  });

  it('recognizes configured issuer domains as primary sources', () => {
    const result = rankRetrievalSources(
      [source('ir', 'https://investor.nvidia.com/news/1', 'NVIDIA results')],
      { now: NOW, issuerDomains: ['investor.nvidia.com'] }
    );
    expect(result.selected[0].sourceClass).toBe('issuer');
  });

  it('enforces domain diversity in Top-K', () => {
    const result = rankRetrievalSources(
      [
        source('r1', 'https://reuters.com/a', 'Company result one'),
        source('r2', 'https://reuters.com/b', 'Company result two'),
        source('r3', 'https://reuters.com/c', 'Company result three'),
        source('other', 'https://independent.test/a', 'Independent analysis'),
      ],
      { now: NOW, topK: 3, maxPerDomain: 2 }
    );
    expect(result.selected.map((item) => item.source.id)).toEqual([
      'r1',
      'r2',
      'other',
    ]);
    expect(
      result.dropped.find((item) => item.source.id === 'r3')?.decisionReason
    ).toBe('domain_diversity_limit');
  });

  it('penalizes unavailable sources without dropping their provenance', () => {
    const unavailable = source(
      'blocked',
      'https://reuters.com/blocked',
      'Company result'
    );
    unavailable.available = false;
    const result = rankRetrievalSources(
      [
        unavailable,
        source('open', 'https://open.test/result', 'Company result explained'),
      ],
      { now: NOW, topK: 1 }
    );
    expect(result.selected[0].source.id).toBe('open');
    expect(result.dropped.map((item) => item.source.id)).toContain('blocked');
  });

  it('records a machine-readable policy version and all decisions', () => {
    const result = rankRetrievalSources(
      [
        source('a', 'https://a.test/1', 'One'),
        source('b', 'https://b.test/2', 'Two'),
      ],
      { now: NOW, topK: 1 }
    );
    expect(result.policyVersion).toBe(RETRIEVAL_RANKING_POLICY_VERSION);
    expect(result.selected).toHaveLength(1);
    expect(result.dropped).toHaveLength(1);
    expect(result.selected[0].decisionReason).toBe(
      'selected_by_quality_and_diversity'
    );
    expect(result.dropped[0].decisionReason).toBe('top_k_limit');
  });
});
