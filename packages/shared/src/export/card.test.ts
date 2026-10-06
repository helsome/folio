import { describe, expect, it } from 'bun:test'
import { escapeXml, pickShareSections, reportToShareCard, wrapText } from './index.ts'
import { reportFixture } from './test-helpers.ts'

const FORBIDDEN = ['portfolio', 'account', 'position', 'holding', 'balance']

describe('reportToShareCard', () => {
  it('renders symbol, stance, confidence, strategy and Folio footer', () => {
    const { svg, text } = reportToShareCard(reportFixture())
    expect(svg).toContain('AAPL.US')
    expect(svg).toContain('BULLISH')
    expect(svg).toContain('82% confidence')
    expect(svg).toContain('Growth')
    expect(svg).toContain('Folio')
    expect(text).toContain('AAPL.US — BULLISH · 82% confidence')
    expect(text).toContain('— Folio research snapshot')
  })

  it('shows the top-3 preferred section verdicts (growth/valuation/risk first)', () => {
    const { svg } = reportToShareCard(reportFixture())
    expect(svg).toContain('Growth</text>')
    expect(svg).toContain('Valuation</text>')
    expect(svg).toContain('Fundamentals</text>')
    // The fourth section must not appear on the card.
    expect(svg).not.toContain('Technical</text>')
    // Verdict labels per section.
    expect(svg).toContain('>Positive</text>')
    expect(svg).toContain('>Negative</text>')
  })

  it('renders the key risk line', () => {
    const { svg, text } = reportToShareCard(reportFixture())
    expect(svg).toContain('KEY RISK')
    // Long risks wrap across card lines; the plain text keeps the full line.
    expect(svg).toContain('Valuation remains expensive; any growth hiccup')
    expect(text).toContain('Key risk: Valuation remains expensive; any growth hiccup hits the multiple.')
  })

  it('falls back to a no-risk note when the report has no risks', () => {
    const { svg } = reportToShareCard(reportFixture({ risks: [] }))
    expect(svg).toContain('No key risks flagged.')
  })

  it('is a well-formed svg document', () => {
    const { svg } = reportToShareCard(reportFixture())
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true)
    expect(svg).toContain('viewBox="0 0 640 460"')
    expect(svg).toContain('aria-label="Folio research snapshot for AAPL.US"')
  })

  it('escapes XML-sensitive characters', () => {
    const card = reportToShareCard(
      reportFixture({
        symbol: 'X&Y.US',
        risks: ['Margin < 10% & guidance cut > 5%'],
      })
    )
    expect(card.svg).not.toContain('< 10%')
    expect(card.svg).toContain('&amp;')
    expect(card.svg).toContain('&lt;')
    expect(card.svg).toContain('&gt;')
    expect(escapeXml('<a b="c">&')).toBe('&lt;a b=&quot;c&quot;&gt;&amp;')
  })

  it('never contains portfolio/account data (spec §55)', () => {
    const { svg, text } = reportToShareCard(reportFixture())
    const combined = `${svg}\n${text}`.toLowerCase()
    for (const word of FORBIDDEN) {
      expect(combined).not.toContain(word)
    }
  })

  it('truncates a long key risk to two card lines', () => {
    const longRisk = 'A'.repeat(60) + ' ' + 'B'.repeat(60) + ' ' + 'C'.repeat(60)
    const { svg } = reportToShareCard(reportFixture({ risks: [longRisk] }))
    expect(svg).toContain('…')
  })

  it('wraps a whitespace-free CJK key risk into the two-line risk block', () => {
    const cjkRisk =
      '估值仍处高位而盈利增速与订单动能同步放缓一旦指引下修可能触发估值与业绩同步回落须警惕流动性收紧与汇率波动带来的二次冲击'
    const { svg } = reportToShareCard(reportFixture({ risks: [cjkRisk] }))
    const rendered = [...svg.matchAll(/<text x="32" y="(?:310|334|358)"[^>]*>([^<]*)<\/text>/g)].map(
      (match) => match[1]
    )
    expect(rendered).toHaveLength(2)
    for (const line of rendered) {
      // 56 columns of budget → at most 28 full-width glyphs per line.
      expect([...line].length).toBeLessThanOrEqual(28)
    }
    expect(svg).toContain('…')
  })

  it('is deterministic — identical reports render identical bytes', () => {
    const report = reportFixture()
    const first = reportToShareCard(report)
    const second = reportToShareCard(report)
    expect(first.svg).toBe(second.svg)
    expect(first.text).toBe(second.text)
  })
})

describe('pickShareSections', () => {
  it('prefers growth/valuation/risk-like sections, then report order', () => {
    const report = reportFixture()
    const picked = pickShareSections(report)
    expect(picked.map((s) => s.key)).toEqual(['growth', 'valuation', 'fundamentals'])
  })

  it('falls back to the first sections when none match the preference keys', () => {
    const report = reportFixture({
      sections: [
        { key: 'momentum', title: 'Momentum', verdict: 'positive', summary: 'a', evidence: [] },
        { key: 'news', title: 'News', verdict: 'neutral', summary: 'b', evidence: [] },
        { key: 'technical', title: 'Technical', verdict: 'negative', summary: 'c', evidence: [] },
      ],
    })
    expect(pickShareSections(report).map((s) => s.key)).toEqual(['momentum', 'news', 'technical'])
  })

  it('caps at three sections', () => {
    expect(pickShareSections(reportFixture())).toHaveLength(3)
  })
})

describe('wrapText', () => {
  it('splits on word boundaries at the max width', () => {
    expect(wrapText('one two three four', 9)).toEqual(['one two', 'three', 'four'])
  })

  it('keeps over-long single words on their own line', () => {
    expect(wrapText('supercalifragilistic', 5)).toEqual(['supercalifragilistic'])
  })

  it('returns an empty array for empty input', () => {
    expect(wrapText('', 10)).toEqual([])
  })

  it('breaks CJK text between ideographs — it has no whitespace to split on', () => {
    // Eight full-width glyphs at two columns each → three glyphs per 6-column line.
    expect(wrapText('中文测试中文测试', 6)).toEqual(['中文测', '试中文', '测试'])
  })

  it('keeps the whitespace that separates mixed CJK and Latin atoms', () => {
    expect(wrapText('AAPL 上涨明显', 10)).toEqual(['AAPL 上涨', '明显'])
  })
})
