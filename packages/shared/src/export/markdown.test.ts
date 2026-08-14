import { describe, expect, it } from 'bun:test'
import { reportToMarkdown, strategyName } from './index.ts'
import { reportFixture } from './test-helpers.ts'

describe('reportToMarkdown', () => {
  it('renders title, stance, confidence and strategy badge', () => {
    const md = reportToMarkdown(reportFixture())
    expect(md).toContain('# AAPL.US — Research Report')
    expect(md).toContain('**BULLISH**')
    expect(md).toContain('Confidence: 82%')
    expect(md).toContain('Strategy: Growth')
    expect(md).toContain('Generated 2026-07-14T')
  })

  it('renders the summary and every section with verdict + summary', () => {
    const md = reportToMarkdown(reportFixture())
    expect(md).toContain('## Sections')
    for (const section of reportFixture().sections) {
      expect(md).toContain(`### ${section.title} — ${section.verdict === 'positive' ? 'Positive' : section.verdict === 'negative' ? 'Negative' : 'Neutral'}`)
      expect(md).toContain(section.summary)
    }
  })

  it('renders bull/bear/catalysts/risks bullets', () => {
    const md = reportToMarkdown(reportFixture())
    expect(md).toContain('## Bull Case')
    expect(md).toContain('- Services margin expansion.')
    expect(md).toContain('## Bear Case')
    expect(md).toContain('- Compression risk if AI capex disappoints.')
    expect(md).toContain('## Catalysts')
    expect(md).toContain('- Next earnings print.')
    expect(md).toContain('## Risks')
    expect(md).toContain('- Supply chain concentration.')
  })

  it('links every evidence claim to its capability and run id', () => {
    const md = reportToMarkdown(reportFixture())
    expect(md).toContain('## Evidence')
    expect(md).toContain('- Growth: Services revenue grew 18% YoY. — company.financials (run run_g1)')
    expect(md).toContain('- Valuation: P/E at the 95th percentile. — company.valuation (run run_v1)')
  })

  it('omits the evidence list when includeEvidence is false', () => {
    const md = reportToMarkdown(reportFixture(), { includeEvidence: false })
    expect(md).not.toContain('## Evidence')
    expect(md).not.toContain('run run_g1')
  })

  it('omits the strategy badge when includeStrategy is false or strategy is unknown', () => {
    expect(reportToMarkdown(reportFixture(), { includeStrategy: false })).not.toContain('Strategy: Growth')
    expect(reportToMarkdown(reportFixture({ strategyId: undefined }))).not.toContain('Strategy:')
    expect(strategyName('not-a-strategy')).toBeUndefined()
  })

  it('never emits undefined/NaN placeholders', () => {
    const md = reportToMarkdown(reportFixture({ confidence: 0, sections: [] }))
    expect(md).not.toContain('undefined')
    expect(md).not.toContain('NaN')
    expect(md).toContain('Confidence: 0%')
  })

  it('marks empty bullet lists instead of silently dropping them', () => {
    const md = reportToMarkdown(reportFixture({ bullCase: [], risks: [] }))
    expect(md).toContain('## Bull Case')
    expect(md).toContain('_None listed._')
    expect(md).toContain('## Risks')
  })

  it('is deterministic — identical reports render identical bytes', () => {
    const report = reportFixture()
    expect(reportToMarkdown(report)).toBe(reportToMarkdown(report))
  })
})
