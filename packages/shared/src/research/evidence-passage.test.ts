import { describe, expect, it } from 'bun:test';
import type { CapabilityResult, NewsItem, SourcePassage } from '@finagent/core';
import {
  buildCapabilityPassages,
  locatePassage,
  passageIdOf,
  passagesForEvidence,
  relocatePassage,
} from './evidence-passage.ts';

function provenance() {
  return { provider: 'longbridge', fetchedAt: 1_700_000_000_000, stale: false };
}

function newsItem(overrides: Partial<NewsItem> = {}): NewsItem {
  return {
    id: 'n1',
    title: 'Acme beats guidance',
    summary: 'Acme reported revenue above guidance.',
    url: 'https://example.com/acme-q3',
    timestamp: 1_700_000_000,
    symbols: ['ACME.US'],
    ...overrides,
  };
}

function newsResult(items: NewsItem[]): CapabilityResult<unknown> {
  return { data: items, provenance: provenance(), summary: 'ACME.US News' };
}

const NEWS_SOURCE_TEXT = 'Acme beats guidance\n\nAcme reported revenue above guidance.';

describe('locatePassage', () => {
  it('returns exact offsets that slice back to the excerpt', () => {
    const source = 'Revenue rose 12%. Guidance was unchanged for the year.';
    const excerpt = 'Guidance was unchanged for the year.';

    const location = locatePassage(source, excerpt);

    expect(location).toBeDefined();
    expect(source.slice(location!.start, location!.end)).toBe(excerpt);
  });

  it('reports 1-based line and column for a multi-line source', () => {
    const source = 'First line.\nSecond line with the passage here.\nThird line.';

    const location = locatePassage(source, 'the passage here');

    expect(location).toEqual({ start: 29, end: 45, line: 2, column: 18 });
    expect(source.slice(location!.start, location!.end)).toBe('the passage here');
  });

  it('tolerates re-wrapped whitespace while keeping offsets in the original text', () => {
    const source = 'Alpha\n   beta   gamma\ndelta';

    const location = locatePassage(source, 'beta gamma');

    expect(location).toEqual({ start: 9, end: 21, line: 2, column: 4 });
    expect(source.slice(location!.start, location!.end)).toBe('beta   gamma');
  });

  it('treats the excerpt literally instead of as a pattern', () => {
    const source = 'EPS (diluted) rose 12% to $1.23.';

    const location = locatePassage(source, 'EPS (diluted)');

    expect(location).toEqual({ start: 0, end: 13, line: 1, column: 1 });
  });

  it('selects a specific occurrence and refuses an out-of-range one', () => {
    const source = 'risk risk risk';

    expect(locatePassage(source, 'risk', { occurrence: 2 })).toEqual({
      start: 5,
      end: 9,
      line: 1,
      column: 6,
    });
    expect(locatePassage(source, 'risk', { occurrence: 4 })).toBeUndefined();
    expect(locatePassage(source, 'risk', { occurrence: 0 })).toBeUndefined();
  });

  it('fails closed instead of matching a paraphrase', () => {
    const source = 'Revenue rose 12% year over year.';

    expect(locatePassage(source, 'Revenue fell 12% year over year.')).toBeUndefined();
    expect(locatePassage(source, 'Revenue grew 12% year over year.')).toBeUndefined();
  });

  it('fails closed on empty input rather than returning offset zero', () => {
    expect(locatePassage('some source text', '')).toBeUndefined();
    expect(locatePassage('some source text', '   \n  ')).toBeUndefined();
    expect(locatePassage('', 'anything')).toBeUndefined();
  });

  it('refuses an excerpt too long to be a passage', () => {
    const long = Array.from({ length: 401 }, (_, index) => `w${index}`).join(' ');

    expect(locatePassage(long, long)).toBeUndefined();
  });
});

describe('relocatePassage', () => {
  it('re-derives the same location from the same text after a JSON round-trip', () => {
    const passages = buildCapabilityPassages({
      runId: 'run-1',
      capabilityId: 'research.news',
      result: newsResult([newsItem()]),
    });
    const reloaded = JSON.parse(JSON.stringify(passages)) as SourcePassage[];

    expect(reloaded[0].location).toEqual(passages[0].location);
    expect(relocatePassage(reloaded[0], NEWS_SOURCE_TEXT)).toEqual(passages[0].location);
  });

  it('reports the passage as unresolvable when the source changed', () => {
    const passage = { excerpt: 'Acme reported revenue above guidance.' };

    expect(relocatePassage(passage, 'Acme beats guidance\n\nA rewritten article.')).toBeUndefined();
  });

  it('never falls back to a stored offset that no longer matches', () => {
    const source = 'Acme misses guidance\n\nGuidance was withdrawn.';

    expect(locatePassage(source, 'Acme reported revenue above guidance.')).toBeUndefined();
  });
});

describe('buildCapabilityPassages', () => {
  it('records one locatable passage per news item', () => {
    const passages = buildCapabilityPassages({
      runId: 'run-1',
      capabilityId: 'research.news',
      result: newsResult([newsItem()]),
    });

    expect(passages).toHaveLength(1);
    expect(passages[0]).toEqual({
      id: 'passage:run-1:research.news:n1:21-58',
      runId: 'run-1',
      capabilityId: 'research.news',
      documentId: 'n1',
      canonicalUrl: 'https://example.com/acme-q3',
      excerpt: 'Acme reported revenue above guidance.',
      location: { start: 21, end: 58, line: 3, column: 1 },
    });
    expect(NEWS_SOURCE_TEXT.slice(passages[0].location.start, passages[0].location.end))
      .toBe(passages[0].excerpt);
  });

  it('gives one piece of evidence several passages (many-to-many)', () => {
    const passages = buildCapabilityPassages({
      runId: 'run-1',
      capabilityId: 'research.news',
      result: newsResult([
        newsItem(),
        newsItem({
          id: 'n2',
          title: 'Acme raises outlook',
          summary: 'The outlook was raised for the full year.',
          url: 'https://example.com/acme-outlook',
        }),
      ]),
    });

    expect(passages).toHaveLength(2);
    expect(passages.map((passage) => passage.documentId)).toEqual(['n1', 'n2']);
    expect(passages[1].location).toEqual({ start: 21, end: 62, line: 3, column: 1 });
    expect(passagesForEvidence(passages, { runId: 'run-1', capabilityId: 'research.news' }))
      .toHaveLength(2);
  });

  it('derives ids from source identity, not array position', () => {
    const first = newsItem();
    const second = newsItem({ id: 'n2', title: 'Acme raises outlook', summary: 'Outlook raised.' });

    const forward = buildCapabilityPassages({
      runId: 'run-1',
      capabilityId: 'research.news',
      result: newsResult([first, second]),
    });
    const reversed = buildCapabilityPassages({
      runId: 'run-1',
      capabilityId: 'research.news',
      result: newsResult([second, first]),
    });

    expect(reversed.map((passage) => passage.id)).toEqual([forward[1].id, forward[0].id]);
  });

  it('falls back to the headline when a news item has no summary', () => {
    const passages = buildCapabilityPassages({
      runId: 'run-1',
      capabilityId: 'research.news',
      result: newsResult([newsItem({ summary: '' })]),
    });

    expect(passages).toHaveLength(1);
    expect(passages[0].excerpt).toBe('Acme beats guidance');
    expect(passages[0].location).toEqual({ start: 0, end: 19, line: 1, column: 1 });
  });

  it('skips items that carry no retrievable text', () => {
    const passages = buildCapabilityPassages({
      runId: 'run-1',
      capabilityId: 'research.news',
      result: newsResult([newsItem({ title: '', summary: '   ' })]),
    });

    expect(passages).toEqual([]);
  });

  it('refuses to locate a generated capability summary', () => {
    const passages = buildCapabilityPassages({
      runId: 'run-1',
      capabilityId: 'market.quote',
      result: {
        data: { symbol: 'ACME.US', change: 3 },
        provenance: provenance(),
        summary: 'ACME.US price momentum reads positive.',
      },
    });

    expect(passages).toEqual([]);
  });

  it('returns no passages when news data is malformed', () => {
    expect(buildCapabilityPassages({
      runId: 'run-1',
      capabilityId: 'research.news',
      result: { data: [{ id: 'n1' }], provenance: provenance() },
    })).toEqual([]);

    expect(buildCapabilityPassages({
      runId: 'run-1',
      capabilityId: 'research.news',
      result: { data: 'not an array', provenance: provenance() },
    })).toEqual([]);
  });
});

describe('passageIdOf', () => {
  it('is stable and uses the provider document identity when present', () => {
    const location = { start: 1, end: 5, line: 1, column: 2 };

    expect(passageIdOf({ runId: 'r', capabilityId: 'c', documentId: 'd', position: 7, location }))
      .toBe('passage:r:c:d:1-5');
    expect(passageIdOf({ runId: 'r', capabilityId: 'c', documentId: 'd', position: 7, location }))
      .toBe(passageIdOf({ runId: 'r', capabilityId: 'c', documentId: 'd', position: 0, location }));
  });

  it('falls back to position only when the source has no document identity', () => {
    const location = { start: 1, end: 5, line: 1, column: 2 };

    expect(passageIdOf({ runId: 'r', capabilityId: 'c', position: 3, location }))
      .toBe('passage:r:c:#3:1-5');
  });
});

describe('passagesForEvidence', () => {
  it('resolves only the passages produced by that evidence', () => {
    const runOne = buildCapabilityPassages({
      runId: 'run-1',
      capabilityId: 'research.news',
      result: newsResult([newsItem()]),
    });
    const runTwo = buildCapabilityPassages({
      runId: 'run-2',
      capabilityId: 'research.news',
      result: newsResult([newsItem({ id: 'n9' })]),
    });
    const passages = [...runOne, ...runTwo];

    expect(passagesForEvidence(passages, { runId: 'run-2', capabilityId: 'research.news' }))
      .toEqual(runTwo);
    expect(passagesForEvidence(passages, { runId: 'run-1', capabilityId: 'market.quote' }))
      .toEqual([]);
    expect(passagesForEvidence(passages, { runId: 'missing', capabilityId: 'research.news' }))
      .toEqual([]);
  });
});
