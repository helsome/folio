import type { ResearchReport } from '@finagent/core'

/**
 * Deterministic ResearchReport fixture for export tests. Fixed timestamp so
 * every renderer output is byte-identical run to run.
 */
export function reportFixture(overrides: Partial<ResearchReport> = {}): ResearchReport {
  return {
    id: 'rpt_export_1',
    symbol: 'AAPL.US',
    generatedAt: 1_784_000_000_000,
    strategyId: 'growth',
    summary: 'AAPL benefits from expanding services margins while valuation stays elevated.',
    stance: 'bullish',
    confidence: 0.82,
    sections: [
      {
        key: 'growth',
        title: 'Growth',
        verdict: 'positive',
        summary: 'Services revenue compounding in the high teens.',
        evidence: [
          {
            capabilityId: 'company.financials',
            runId: 'run_g1',
            claim: 'Services revenue grew 18% YoY.',
            fetchedAt: 1_784_000_000_000,
            summary: 'Revenue growth strong.',
          },
        ],
      },
      {
        key: 'valuation',
        title: 'Valuation',
        verdict: 'negative',
        summary: 'Multiple above the five-year average.',
        evidence: [
          {
            capabilityId: 'company.valuation',
            runId: 'run_v1',
            claim: 'P/E at the 95th percentile.',
            fetchedAt: 1_784_000_000_000,
          },
        ],
      },
      {
        key: 'fundamentals',
        title: 'Fundamentals',
        verdict: 'positive',
        summary: 'Balance sheet carries net cash.',
        evidence: [],
      },
      {
        key: 'technical',
        title: 'Technical',
        verdict: 'neutral',
        summary: 'Trend intact but momentum cooling.',
        evidence: [],
      },
    ],
    bullCase: ['Services margin expansion.', 'Net cash balance sheet.'],
    bearCase: ['Compression risk if AI capex disappoints.'],
    catalysts: ['Next earnings print.'],
    risks: [
      'Valuation remains expensive; any growth hiccup hits the multiple.',
      'Supply chain concentration.',
    ],
    capabilityRuns: [
      { runId: 'run_g1', capabilityId: 'company.financials', status: 'success', fetchedAt: 1_784_000_000_000 },
      { runId: 'run_v1', capabilityId: 'company.valuation', status: 'success', fetchedAt: 1_784_000_000_000 },
    ],
    runStatus: 'completed',
    ...overrides,
  }
}
