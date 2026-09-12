import { describe, expect, it } from 'bun:test';
import { assertValidGoldCaseDataset, validateGoldCaseDataset } from '@finagent/core';
import { deepResearchGoldV1Dataset } from './deep-research-gold-v1.ts';
import { embeddedDatasets } from './index.ts';

describe('deep-research-gold-v1 dataset', () => {
  it('contains the required ten research failure-mode cases', () => {
    expect(deepResearchGoldV1Dataset.cases).toHaveLength(10);
    expect(deepResearchGoldV1Dataset.cases.map((item) => item.id)).toEqual([
      'drg-v1-single-fact', 'drg-v1-cross-source', 'drg-v1-cited-summary',
      'drg-v1-root-cause', 'drg-v1-conflict', 'drg-v1-insufficient',
      'drg-v1-multistep', 'drg-v1-long-synthesis', 'drg-v1-evidence-map',
      'drg-v1-unsupported',
    ]);
  });

  it('passes the deterministic Gold Case contract', () => {
    expect(validateGoldCaseDataset(deepResearchGoldV1Dataset)).toEqual([]);
    expect(() => assertValidGoldCaseDataset(deepResearchGoldV1Dataset)).not.toThrow();
  });

  it('rejects duplicate ids and invalid rubric weights', () => {
    const invalid = {
      ...deepResearchGoldV1Dataset,
      cases: [
        {
          ...deepResearchGoldV1Dataset.cases[0],
          rubric: {
            ...deepResearchGoldV1Dataset.cases[0].rubric,
            criteria: { correctness: { description: 'bad', weight: 2 } },
          },
        },
        { ...deepResearchGoldV1Dataset.cases[1], id: deepResearchGoldV1Dataset.cases[0].id },
      ],
    };
    const issues = validateGoldCaseDataset(invalid);
    expect(issues.some((issue) => issue.path === 'cases[1].id')).toBe(true);
    expect(issues.some((issue) => issue.path === 'cases[0].rubric.criteria')).toBe(true);
  });

  it('is available to the existing evaluation runner catalog', () => {
    const entry = embeddedDatasets.find((item) => item.id === 'deep-research-gold-v1');
    expect(entry?.version).toBe('1.0.0');
    expect(entry?.load()).toBe(deepResearchGoldV1Dataset);
  });
});
