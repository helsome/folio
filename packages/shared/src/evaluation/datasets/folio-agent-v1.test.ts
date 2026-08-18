// Benchmark dataset integrity tests (spec §22-23).
//
// These guard the embedded benchmark itself: structural invariants a runner
// and the release gates depend on. Changing a case requires a version bump
// (spec §25) — not a test edit to silence this file.
import { describe, expect, it } from 'bun:test';
import type {
  EvaluationCase,
  EvaluationCategory,
  EvaluationDifficulty,
} from '@finagent/core';
import { folioAgentV1Dataset } from './folio-agent-v1.ts';
import { embeddedDatasets } from './index.ts';

/** The twenty capability ids of the Capability Registry (spec §20). */
const VALID_CAPABILITIES = {
  'market.quote': true,
  'market.kline': true,
  'market.intraday': true,
  'market.status': true,
  'market.depth': true,
  'market.trades': true,
  'market.capitalFlow': true,
  'market.sentiment': true,
  'company.profile': true,
  'company.valuation': true,
  'company.financials': true,
  'company.ratings': true,
  'company.dividends': true,
  'company.earnings': true,
  'research.news': true,
  'research.events': true,
  'portfolio.summary': true,
  'portfolio.positions': true,
  'portfolio.assets': true,
  'portfolio.cashFlow': true,
} satisfies Record<string, boolean>;

const CATEGORIES: EvaluationCategory[] = [
  'market',
  'research',
  'tool-selection',
  'tool-arguments',
  'grounded',
  'strategy',
  'provider-failure',
  'portfolio',
  'compare',
  'long-tail',
  'adversarial',
];

const DIFFICULTIES: EvaluationDifficulty[] = [
  'golden',
  'difficult',
  'long_tail',
  'tool_failure',
  'regression',
  'adversarial',
];

const VALID_SOURCES = {
  'hand-authored': true,
  'real-trace': true,
  'regression-bug': true,
  'provider-fixture': true,
  'historical-issue': true,
} satisfies Record<string, boolean>;

function capabilitySets(
  case_: EvaluationCase,
): Record<'required' | 'optional' | 'forbidden', string[]> {
  return {
    required: case_.expected.requiredCapabilities ?? [],
    optional: case_.expected.optionalCapabilities ?? [],
    forbidden: case_.expected.forbiddenCapabilities ?? [],
  };
}

describe('folio-agent-v1 dataset', () => {
  const { cases } = folioAgentV1Dataset;

  it('ships between 50 and 100 hand-authored cases', () => {
    expect(cases.length).toBeGreaterThanOrEqual(50);
    expect(cases.length).toBeLessThanOrEqual(100);
  });

  it('has unique case ids', () => {
    const ids = cases.map((case_) => case_.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers every category', () => {
    const present = new Set(cases.map((case_) => case_.category));
    for (const category of CATEGORIES) {
      expect(present.has(category)).toBe(true);
    }
  });

  it('covers every difficulty', () => {
    const present = new Set(cases.map((case_) => case_.difficulty));
    for (const difficulty of DIFFICULTIES) {
      expect(present.has(difficulty)).toBe(true);
    }
  });

  it('uses only valid capability ids in expectations', () => {
    for (const case_ of cases) {
      const { required, optional, forbidden } = capabilitySets(case_);
      for (const capability of [...required, ...optional, ...forbidden]) {
        expect(capability in VALID_CAPABILITIES).toBe(true);
      }
    }
  });

  it('never overlaps required and forbidden capabilities', () => {
    for (const case_ of cases) {
      const { required, forbidden } = capabilitySets(case_);
      const forbiddenSet = new Set(forbidden);
      for (const capability of required) {
        expect(forbiddenSet.has(capability)).toBe(false);
      }
    }
  });

  it('keeps optional capabilities disjoint from required and forbidden', () => {
    for (const case_ of cases) {
      const { required, optional, forbidden } = capabilitySets(case_);
      const forbiddenSet = new Set(forbidden);
      for (const capability of optional) {
        expect(required.includes(capability)).toBe(false);
        expect(forbiddenSet.has(capability)).toBe(false);
      }
    }
  });

  it('has well-formed inputs and sources', () => {
    for (const case_ of cases) {
      expect(case_.input.prompt.trim().length).toBeGreaterThan(0);
      expect(case_.source in VALID_SOURCES).toBe(true);
    }
  });

  it('registers as the embedded folio-agent-v1 dataset', () => {
    const embedded = embeddedDatasets.find((entry) => entry.id === 'folio-agent-v1');
    expect(embedded).toBeDefined();
    expect(embedded?.version).toBe(folioAgentV1Dataset.version);
    expect(embedded?.load()).toBe(folioAgentV1Dataset);
  });
});