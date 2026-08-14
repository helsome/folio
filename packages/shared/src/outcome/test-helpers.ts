import type { Kline, ResearchOpinion, ResearchReport, ResearchSection } from '@finagent/core'

/**
 * Deterministic fixtures for outcome tests. `makeReport` builds a report
 * whose sections carry quote-capability evidence with an embeddable price so
 * the entry-snapshot path is exercised; `makeOpinion` builds an opinion with
 * an explicit entry price (or none) and a caller-controlled createdAt.
 */

export const NOW_MS = 1_800_000_000_000

export function makeSection(
  key: string,
  overrides: Partial<ResearchSection> = {}
): ResearchSection {
  return {
    key,
    title: key,
    verdict: 'positive',
    summary: `${key} analysis`,
    evidence: [],
    ...overrides,
  }
}

export function makeReport(overrides: Partial<ResearchReport> = {}): ResearchReport {
  return {
    id: 'report-r1',
    symbol: 'AAPL.US',
    generatedAt: NOW_MS - 60_000,
    strategyId: 'value',
    summary: 'fixture report',
    stance: 'bullish',
    confidence: 0.8,
    sections: [
      makeSection('valuation', {
        evidence: [
          {
            capabilityId: 'market.quote',
            runId: 'run-quote',
            claim: 'price momentum',
            fetchedAt: NOW_MS - 30_000,
            summary: '[up] AAPL.US: $150.00\nChange: +1.00 (+0.67%)',
          },
        ],
      }),
      makeSection('fundamentals', {
        evidence: [
          {
            capabilityId: 'company.valuation',
            runId: 'run-valuation',
            claim: 'pe',
            fetchedAt: NOW_MS - 10_000,
          },
        ],
      }),
    ],
    bullCase: ['bull'],
    bearCase: ['bear'],
    catalysts: ['catalyst'],
    risks: ['risk'],
    capabilityRuns: [
      { runId: 'run-quote', capabilityId: 'market.quote', status: 'success', fetchedAt: NOW_MS - 30_000 },
      { runId: 'run-kline', capabilityId: 'market.kline', status: 'success', fetchedAt: NOW_MS - 20_000 },
      { runId: 'run-valuation', capabilityId: 'company.valuation', status: 'success', fetchedAt: NOW_MS - 10_000 },
    ],
    runStatus: 'completed',
    ...overrides,
  }
}

/** A report with no quote evidence and no capability runs (the honest empty path). */
export function makeBareReport(overrides: Partial<ResearchReport> = {}): ResearchReport {
  return {
    id: 'report-bare',
    symbol: 'MSFT.US',
    generatedAt: NOW_MS - 60_000,
    strategyId: 'growth',
    summary: 'bare report',
    stance: 'neutral',
    confidence: 0.5,
    sections: [makeSection('technical')],
    bullCase: [],
    bearCase: [],
    catalysts: [],
    risks: [],
    capabilityRuns: [],
    runStatus: 'partial',
    ...overrides,
  }
}

export function makeKline(timestampSec: number, close: number): Kline {
  return {
    symbol: 'AAPL.US',
    timestamp: timestampSec,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1000,
  }
}

/** Ascending daily bars starting at `startSec`, one per close value. */
export function dailyBars(startSec: number, closes: number[]): Kline[] {
  const day = 24 * 60 * 60
  return closes.map((close, index) => makeKline(startSec + index * day, close))
}

export function makeOpinion(overrides: Partial<ResearchOpinion> = {}): ResearchOpinion {
  return {
    id: 'opinion-1',
    reportId: 'report-1',
    symbol: 'AAPL.US',
    strategyId: 'value',
    skillIds: [],
    stance: 'bullish',
    confidence: 0.8,
    horizon: '1m',
    createdAt: NOW_MS,
    entryPrice: 100,
    evidenceRefs: [],
    ...overrides,
  }
}
