import { describe, expect, it } from 'bun:test';
import type { EvaluationCase, EvaluationDataset, EvaluationDifficulty } from '../../packages/core/src/index.ts';
import { selectCases } from './select-cases.ts';

function caseItem(input: { id: string; tags?: string[]; difficulty?: EvaluationDifficulty }): EvaluationCase {
  return {
    id: input.id,
    name: input.id,
    category: 'market',
    difficulty: input.difficulty ?? 'golden',
    input: { prompt: `Prompt for ${input.id}` },
    expected: {},
    tags: input.tags ?? [],
    source: 'hand-authored',
  };
}

function dataset(cases: EvaluationCase[]): EvaluationDataset {
  return {
    id: 'test-v1',
    version: '1.0.0',
    name: 'Test dataset',
    createdAt: 0,
    cases,
  };
}

function fixtureCases(): EvaluationCase[] {
  return [
    caseItem({ id: 'c1', tags: ['quote', 'golden-path'] }),
    caseItem({ id: 'c2', tags: ['quote', 'us-market'] }),
    caseItem({ id: 'c3', difficulty: 'difficult', tags: ['research'] }),
    caseItem({ id: 'c4', difficulty: 'regression', tags: ['regression', 'quote'] }),
    caseItem({ id: 'c5', difficulty: 'regression', tags: ['regression', 'freshness'] }),
  ];
}

describe('selectCases', () => {
  it('returns every case when no filter or limit is set', () => {
    const selected = selectCases(dataset(fixtureCases()), false, undefined);
    expect(selected.map((item) => item.id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
  });

  it('keeps only the requested case ids', () => {
    const selected = selectCases(dataset(fixtureCases()), false, undefined, { caseIds: ['c2', 'c4'] });
    expect(selected.map((item) => item.id)).toEqual(['c2', 'c4']);
  });

  it('returns no cases when a case id does not match', () => {
    const selected = selectCases(dataset(fixtureCases()), false, undefined, { caseIds: ['missing'] });
    expect(selected).toEqual([]);
  });

  it('keeps cases carrying any requested tag', () => {
    const selected = selectCases(dataset(fixtureCases()), false, undefined, { tags: ['research', 'freshness'] });
    expect(selected.map((item) => item.id)).toEqual(['c3', 'c5']);
  });

  it('intersects case id and tag filters', () => {
    const selected = selectCases(dataset(fixtureCases()), false, undefined, {
      caseIds: ['c3'],
      tags: ['research'],
    });
    expect(selected.map((item) => item.id)).toEqual(['c3']);

    const empty = selectCases(dataset(fixtureCases()), false, undefined, {
      caseIds: ['c3'],
      tags: ['quote'],
    });
    expect(empty).toEqual([]);
  });

  it('preserves the smoke subset when no explicit filter is set', () => {
    const selected = selectCases(dataset(fixtureCases()), true, undefined);
    expect(selected.map((item) => item.id)).toEqual(['c4', 'c5', 'c1', 'c2']);
  });

  it('lets explicit filters bypass the smoke subset', () => {
    const selected = selectCases(dataset(fixtureCases()), true, undefined, { caseIds: ['c3'] });
    expect(selected.map((item) => item.id)).toEqual(['c3']);
  });

  it('applies maxCases after explicit filters', () => {
    const selected = selectCases(dataset(fixtureCases()), false, 2, { tags: ['quote'] });
    expect(selected.map((item) => item.id)).toEqual(['c1', 'c2']);
  });
});
