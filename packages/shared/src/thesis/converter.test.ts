import { describe, expect, it } from 'bun:test';
import type { ResearchReport } from '@finagent/core';
import { parseImpactJson } from './agent-eval.ts';
import { parseThesisDraftJson, reportToThesis } from './converter.ts';

/** Capture the `.code` of a thrown error (code errors carry the code on `error.code`). */
function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}


function makeReport(): ResearchReport {
  return {
    id: 'report-1',
    symbol: 'NVDA.US',
    generatedAt: 1700000000000,
    summary: 'NVDA leads the AI compute build-out.',
    stance: 'bullish',
    confidence: 0.7,
    sections: [
      {
        key: 'valuation',
        title: 'Valuation',
        verdict: 'neutral',
        summary: 'Rich but supported by growth.',
        evidence: [
          {
            capabilityId: 'company.valuation',
            runId: 'run-valuation',
            claim: 'NVDA valuation is expensive',
            fetchedAt: 1700000000000,
            summary: 'PE 34.1',
          },
        ],
      },
      {
        key: 'momentum',
        title: 'Momentum',
        verdict: 'positive',
        summary: 'Strong uptrend.',
        evidence: [
          {
            capabilityId: 'market.kline',
            runId: 'run-kline',
            claim: 'NVDA is in an uptrend',
            fetchedAt: 1700000000000,
          },
        ],
      },
    ],
    bullCase: ['Data-center demand is compounding'],
    bearCase: ['Valuation compresses in a risk-off'],
    catalysts: ['GTC product cycle'],
    risks: ['China export restrictions'],
    capabilityRuns: [
      { runId: 'run-valuation', capabilityId: 'company.valuation', status: 'success' },
      { runId: 'run-kline', capabilityId: 'market.kline', status: 'success' },
    ],
    runStatus: 'completed',
  };
}

describe('reportToThesis', () => {
  it('maps report fields and carries evidence over', () => {
    const ids: string[] = ['thesis-1'];
    const idGen = () => ids.shift() ?? 'thesis-fallback';
    const thesis = reportToThesis(makeReport(), idGen, () => 42);

    expect(thesis.id).toBe('thesis-1');
    expect(thesis.symbol).toBe('NVDA.US');
    expect(thesis.stance).toBe('bullish');
    expect(thesis.summary).toBe('NVDA leads the AI compute build-out.');
    expect(thesis.bullCase).toEqual(['Data-center demand is compounding']);
    expect(thesis.bearCase).toEqual(['Valuation compresses in a risk-off']);
    expect(thesis.catalysts).toEqual(['GTC product cycle']);
    expect(thesis.risks).toEqual(['China export restrictions']);
    expect(thesis.evidenceRefs).toHaveLength(2);
    expect(thesis.evidenceRefs.map((e) => e.capabilityId)).toEqual([
      'company.valuation',
      'market.kline',
    ]);
    expect(thesis.createdAt).toBe(42);
    expect(thesis.updatedAt).toBe(42);
    expect(thesis.lastReviewedAt).toBe(42);
  });
});

describe('parseThesisDraftJson', () => {
  it('accepts raw JSON', () => {
    const draft = JSON.stringify({
      id: 't-1',
      symbol: 'AAPL.US',
      stance: 'neutral',
      summary: 'Steady.',
      bullCase: [],
      bearCase: [],
      catalysts: [],
      risks: [],
      evidenceRefs: [],
      createdAt: 1,
      updatedAt: 1,
      lastReviewedAt: 1,
    });
    expect(parseThesisDraftJson(draft).symbol).toBe('AAPL.US');
  });

  it('accepts fenced JSON and strips prose', () => {
    const draft = 'Here is the thesis:\n```json\n' + JSON.stringify({
      id: 't-2',
      symbol: 'TSLA.US',
      stance: 'bearish',
      summary: 'Overvalued.',
      bullCase: ['a'],
      bearCase: ['b'],
      catalysts: [],
      risks: [],
      evidenceRefs: [],
      createdAt: 1,
      updatedAt: 1,
      lastReviewedAt: 1,
      targetPrice: 100,
    }) + '\n```';
    expect(parseThesisDraftJson(draft).stance).toBe('bearish');
  });

  it('throws THESIS_PARSE_ERROR on a malformed draft', () => {
    expect(codeOf(() => parseThesisDraftJson('{ "id": "missing-everything" }'))).toBe(
      'THESIS_PARSE_ERROR'
    );
  });
});

describe('parseImpactJson', () => {
  function impact(overrides: Record<string, unknown> = {}) {
    return JSON.stringify({
      kind: 'weakened',
      summary: 'Rating downgraded.',
      updatedThesis: {
        id: 't-1',
        symbol: 'NVDA.US',
        stance: 'bullish',
        summary: 'AI leader.',
        bullCase: [],
        bearCase: [],
        catalysts: [],
        risks: [],
        evidenceRefs: [],
        createdAt: 1,
        updatedAt: 2,
        lastReviewedAt: 2,
      },
      ...overrides,
    });
  }

  it('parses a valid impact', () => {
    const parsed = parseImpactJson(impact());
    expect(parsed.kind).toBe('weakened');
    expect(parsed.summary).toBe('Rating downgraded.');
    expect(parsed.updatedThesis.symbol).toBe('NVDA.US');
  });

  it('rejects an unknown kind', () => {
    expect(codeOf(() => parseImpactJson(impact({ kind: 'exploded' })))).toBe('THESIS_PARSE_ERROR');
  });

  it('rejects a missing summary', () => {
    expect(codeOf(() => parseImpactJson(impact({ summary: '' })))).toBe('THESIS_PARSE_ERROR');
  });

  it('rejects an invalid nested thesis', () => {
    expect(codeOf(() => parseImpactJson(impact({ updatedThesis: { id: 'x' } })))).toBe(
      'THESIS_PARSE_ERROR'
    );
  });
});
