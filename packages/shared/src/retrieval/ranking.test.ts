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
  it('does not merge reports with contradictory signed figures', () => {
    const result = rankRetrievalSources([
      source('gain', 'https://a.test/1', 'Company reports a gain', 'The company reported a change of +10% in quarterly revenue.'),
      source('loss', 'https://b.test/2', 'Company reports a loss', 'The company reported a change of -10% in quarterly revenue.'),
    ], { now: NOW });
    expect(result.independentSourceCount).toBe(2);
  });

  it('keeps different figures apart even when titles match', () => {
    const result = rankRetrievalSources([
      source('a', 'https://a.test/1', 'Quarterly earnings', 'Revenue was $1,000.50 million.'),
      source('b', 'https://b.test/2', 'Quarterly earnings', 'Revenue was $1,200.50 million.'),
    ], { now: NOW });
    expect(result.independentSourceCount).toBe(2);
  });

  it('preserves opposite figures in titles when excerpts are missing', () => {
    const result = rankRetrievalSources([
      source('a', 'https://a.test/1', 'Revenue changes +10%'),
      source('b', 'https://b.test/2', 'Revenue changes -10%'),
    ], { now: NOW });
    expect(result.independentSourceCount).toBe(2);
  });

  it('still deduplicates equivalent figures and unchanged URLs', () => {
    const equivalent = rankRetrievalSources([
      source('a', 'https://a.test/1', 'Quarterly earnings', 'Revenue grew by +10.0% to $1,000.'),
      source('b', 'https://b.test/2', 'Quarterly earnings', 'Revenue grew by 10% to $1000.'),
    ], { now: NOW });
    expect(equivalent.independentSourceCount).toBe(1);

    const sameUrl = rankRetrievalSources([
      source('a', 'https://a.test/1', 'Early report', 'Revenue was 10.'),
      source('b', 'https://a.test/1', 'Updated report', 'Revenue was 20.'),
    ], { now: NOW });
    expect(sameUrl.clusters[0].duplicateRelations[0].relation).toBe('same_url');
  });

  it('does not infer conflicting figures when one excerpt has no numbers', () => {
    const result = rankRetrievalSources([
      source('a', 'https://a.test/1', 'Quarterly earnings', 'Revenue grew 10%.'),
      source('b', 'https://b.test/2', 'Quarterly earnings', 'Revenue grew.'),
    ], { now: NOW });
    expect(result.independentSourceCount).toBe(1);
  });

  it.each([
    [0, 1, 2], [0, 2, 1], [1, 0, 2],
    [1, 2, 0], [2, 0, 1], [2, 1, 0],
  ])('keeps conflicting reports apart through a numberless bridge: %i %i %i', (a, b, c) => {
    const sources = [
      source('gain', 'https://a.test/1', 'Quarterly earnings', 'Revenue rose +10%.'),
      source('loss', 'https://b.test/2', 'Quarterly earnings', 'Revenue rose -10%.'),
      source('bridge', 'https://c.test/3', 'Quarterly earnings', 'Revenue changed.'),
    ];
    const result = rankRetrievalSources([sources[a], sources[b], sources[c]], { now: NOW });
    expect(result.independentSourceCount).toBe(2);
    expect(result.clusters.some((cluster) =>
      cluster.memberIds.includes('gain') && cluster.memberIds.includes('loss')
    )).toBe(false);
  });

  it('recognizes Unicode minus and currency signs without losing large integer precision', () => {
    const result = rankRetrievalSources([
      source('a', 'https://a.test/1', 'Report', 'Net change was −$9007199254740992.'),
      source('b', 'https://b.test/2', 'Report', 'Net change was $9007199254740993.'),
    ], { now: NOW });
    expect(result.independentSourceCount).toBe(2);
  });

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

  it.each([
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ])('merges bridged sources for input order %i, %i, %i', (first, second, third) => {
    const sources = [
      source('original', 'https://original.test/report', 'Issuer bulletin', 'Opening paragraph.'),
      source('filing', 'https://sec.gov/report', 'Regulatory filing', 'Quarterly revenue increased.'),
      source('bridge', 'https://original.test/report?utm_source=feed', 'Report mirror', 'Quarterly revenue increased.'),
    ];
    const input = [first, second, third].map((index) => sources[index]);
    const result = rankRetrievalSources(input, {
      now: NOW,
      nearDuplicateThreshold: 1,
    });

    expect(result.independentSourceCount).toBe(1);
    expect(result.clusters).toHaveLength(1);
    expect([...result.clusters[0].memberIds].sort()).toEqual(['bridge', 'filing', 'original']);
    expect(result.clusters[0].duplicateRelations.map((item) => item.relation).sort()).toEqual([
      'same_content',
      'same_url',
    ]);
    expect(result.selected.map((item) => item.source.id)).toEqual(['filing']);
    expect(result.dropped).toHaveLength(2);
    for (const item of result.dropped) {
      expect(item.decisionReason).toBe('duplicate_of:filing');
      expect(item.clusterId).toBe(result.selected[0].clusterId);
      expect(input[item.originalRank].id).toBe(item.source.id);
    }
  });

  it('preserves existing members and relations when merging populated groups', () => {
    const result = rankRetrievalSources(
      [
        source('a', 'https://a.test/report', 'Issuer bulletin', 'Opening paragraph.'),
        source('a-copy', 'https://a.test/report?utm_source=feed', 'First mirror'),
        source('b', 'https://b.test/report', 'Revenue update', 'Quarterly revenue increased.'),
        source('b-copy', 'https://b.test/report#top', 'Second mirror'),
        source('bridge', 'https://a.test/report', 'Report mirror', 'Quarterly revenue increased.'),
        source('other', 'https://other.test/notice', 'Unrelated policy notice'),
      ],
      { now: NOW, nearDuplicateThreshold: 1 }
    );

    expect(result.independentSourceCount).toBe(2);
    expect(result.selected.map((item) => item.source.id)).toEqual(['a', 'other']);
    const merged = result.clusters.find((cluster) => cluster.representativeId === 'a')!;
    expect(merged.memberIds).toEqual(['a', 'a-copy', 'b', 'b-copy', 'bridge']);
    expect(merged.duplicateRelations).toHaveLength(4);
    expect(merged.duplicateRelations).toEqual(expect.arrayContaining([
      { sourceId: 'a-copy', relation: 'same_url' },
      { sourceId: 'b-copy', relation: 'same_url' },
      { sourceId: 'bridge', relation: 'same_url' },
      { sourceId: 'bridge', relation: 'same_content' },
    ]));
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
