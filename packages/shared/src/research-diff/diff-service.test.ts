import { describe, expect, it } from 'bun:test'
import type {
  EvidenceRef,
  ResearchChange,
  ResearchReport,
  ResearchSection,
} from '@finagent/core'
import { buildDiff, diffIdFor, thesisImpactFromDiff } from './diff-service.ts'

function evidence(capabilityId: string, runId: string, summary: string): EvidenceRef {
  return {
    capabilityId,
    runId,
    claim: `evidence from ${capabilityId}`,
    fetchedAt: 1_700_000_000_000,
    summary,
  }
}

function section(
  key: string,
  verdict: ResearchSection['verdict'],
  title: string,
  summary: string,
  evidenceRefs: EvidenceRef[] = []
): ResearchSection {
  return { key, title, verdict, summary, evidence: evidenceRefs }
}

function report(
  id: string,
  overrides: Partial<ResearchReport> = {}
): ResearchReport {
  return {
    id,
    symbol: 'NVDA.US',
    generatedAt: 1_700_000_000_000,
    strategyId: 'growth-momentum',
    summary: 'synthesis summary',
    stance: 'bullish',
    confidence: 0.7,
    sections: [],
    bullCase: [],
    bearCase: [],
    catalysts: [],
    risks: [],
    capabilityRuns: [],
    runStatus: 'completed',
    ...overrides,
  }
}

/** The canonical fixture pair: every change class present, all deterministic. */
function fixturePair(): { previous: ResearchReport; current: ResearchReport } {
  const previous = report('report-prev', {
    generatedAt: 1_700_000_000_000,
    confidence: 0.7,
    sections: [
      section('valuation', 'positive', 'Valuation', 'Cheap', [
        evidence('company.valuation', 'run-valu-prev', 'Valuation\n-----------------\nSymbol: NVDA.US\nPE: 25.3'),
      ]),
      section('technical', 'neutral', 'Technical', 'Flat', [
        evidence('market.quote', 'run-quote-prev', '[up] NVDA.US: $120.00\nChange: +1.20 (+1.00%)'),
      ]),
      section('analyst-rating', 'positive', 'Analyst Rating', 'Buy', [
        evidence('company.ratings', 'run-rating-prev', 'Ratings for NVDA.US: consensus buy target $140.00.'),
      ]),
    ],
    bullCase: ['AI demand'],
    bearCase: ['Margin pressure'],
    catalysts: ['Earnings beat'],
    risks: ['Competition'],
    capabilityRuns: [
      { runId: 'run-valu-prev', capabilityId: 'company.valuation', status: 'success', fetchedAt: 1_700_000_000_000 },
      { runId: 'run-quote-prev', capabilityId: 'market.quote', status: 'success', fetchedAt: 1_700_000_000_000 },
      { runId: 'run-rating-prev', capabilityId: 'company.ratings', status: 'success', fetchedAt: 1_700_000_000_000 },
    ],
  })

  const current = report('report-cur', {
    generatedAt: 1_700_086_400_000,
    confidence: 0.4,
    sections: [
      section('valuation', 'negative', 'Valuation', 'Expensive', [
        evidence('company.valuation', 'run-valu-cur', 'Valuation\n-----------------\nSymbol: NVDA.US\nPE: 24.1'),
      ]),
      section('technical', 'positive', 'Technical', 'Uptrend', [
        evidence('market.quote', 'run-quote-cur', '[up] NVDA.US: $126.00\nChange: +6.00 (+5.00%)'),
      ]),
      section('analyst-rating', 'positive', 'Analyst Rating', 'Strong Buy', [
        evidence('company.ratings', 'run-rating-cur', 'Ratings for NVDA.US: consensus strong_buy target $150.00.'),
      ]),
      section('earnings', 'neutral', 'Earnings', 'Fresh earnings data', [
        evidence('company.earnings', 'run-eps-cur', 'EPS forecasts for NVDA.US, next mean EPS 1.20.'),
      ]),
    ],
    bullCase: ['AI demand', 'New data center win'],
    bearCase: ['Margin pressure'],
    catalysts: [],
    risks: ['Competition', 'Regulatory scrutiny'],
    capabilityRuns: [
      { runId: 'run-valu-cur', capabilityId: 'company.valuation', status: 'success', fetchedAt: 1_700_086_400_000 },
      { runId: 'run-quote-cur', capabilityId: 'market.quote', status: 'success', fetchedAt: 1_700_086_400_000 },
      { runId: 'run-rating-cur', capabilityId: 'company.ratings', status: 'success', fetchedAt: 1_700_086_400_000 },
      { runId: 'run-eps-cur', capabilityId: 'company.earnings', status: 'success', fetchedAt: 1_700_086_400_000 },
    ],
  })

  return { previous, current }
}

function findChange(diff: { changes: ResearchChange[] }, predicate: (c: ResearchChange) => boolean): ResearchChange {
  const match = diff.changes.find(predicate)
  expect(match).toBeDefined()
  return match as ResearchChange
}

const verdict = (category: string) => (c: ResearchChange) => c.label === 'Verdict' && c.category === category

describe('buildDiff', () => {
  it('classifies a verdict flip as material worsened', () => {
    const { previous, current } = fixturePair()
    const diff = buildDiff(previous, current)
    const flip = findChange(diff, verdict('valuation'))
    expect(flip).toMatchObject({
      category: 'valuation',
      label: 'Verdict',
      before: 'positive',
      after: 'negative',
      direction: 'worsened',
      material: true,
    })
  })

  it('classifies a non-flip verdict improvement', () => {
    const { previous, current } = fixturePair()
    const diff = buildDiff(previous, current)
    const improved = findChange(diff, verdict('technical'))
    expect(improved).toMatchObject({
      category: 'technical',
      before: 'neutral',
      after: 'positive',
      direction: 'improved',
      material: false,
    })
  })

  it('extracts PE ratio change from evidence summaries (deterministic)', () => {
    const { previous, current } = fixturePair()
    const diff = buildDiff(previous, current)
    const pe = findChange(diff, (c) => c.label === 'PE ratio')
    expect(pe).toMatchObject({
      category: 'valuation',
      before: 25.3,
      after: 24.1,
      direction: 'improved',
      material: false,
    })
  })

  it('flags a 5% price move as material via the Price change', () => {
    const { previous, current } = fixturePair()
    const diff = buildDiff(previous, current)
    const price = findChange(diff, (c) => c.label === 'Price')
    expect(price).toMatchObject({
      category: 'technical',
      before: 120,
      after: 126,
      direction: 'improved',
      material: true,
    })
  })

  it('extracts rating label change and target price change', () => {
    const { previous, current } = fixturePair()
    const diff = buildDiff(previous, current)
    const rating = findChange(diff, (c) => c.label === 'Rating')
    expect(rating).toMatchObject({
      category: 'analyst-rating',
      before: 'Buy',
      after: 'Strong Buy',
      direction: 'improved',
      material: true,
    })
    const target = findChange(diff, (c) => c.label === 'Target price')
    expect(target).toMatchObject({ before: 140, after: 150, direction: 'improved', material: false })
  })

  it('marks a new earnings section as new material', () => {
    const { previous, current } = fixturePair()
    const diff = buildDiff(previous, current)
    const added = findChange(diff, (c) => c.label === 'Section' && c.direction === 'new')
    expect(added).toMatchObject({ category: 'earnings', direction: 'new', material: true })
  })

  it('emits a confidence delta change (material at 0.3)', () => {
    const { previous, current } = fixturePair()
    const diff = buildDiff(previous, current)
    const confidence = findChange(diff, (c) => c.label === 'Confidence')
    expect(confidence).toMatchObject({
      category: 'sentiment',
      before: 0.7,
      after: 0.4,
      direction: 'worsened',
      material: true,
    })
  })

  it('diffs the bull/catalyst/risk lists', () => {
    const { previous, current } = fixturePair()
    const diff = buildDiff(previous, current)
    const bullAdded = findChange(diff, (c) => c.label === 'Bull case point' && c.direction === 'new')
    expect(bullAdded).toMatchObject({ category: 'growth', after: 'New data center win', material: false })
    const catalystRemoved = findChange(diff, (c) => c.label === 'Catalyst' && c.direction === 'removed')
    expect(catalystRemoved).toMatchObject({ category: 'growth', before: 'Earnings beat', material: false })
    const riskAdded = findChange(diff, (c) => c.label === 'Risk' && c.direction === 'new')
    expect(riskAdded).toMatchObject({ category: 'risk', after: 'Regulatory scrutiny', material: true })
  })

  it('attaches run ids + fetchedAt as evidence on section changes', () => {
    const { previous, current } = fixturePair()
    const diff = buildDiff(previous, current)
    const flip = findChange(diff, verdict('valuation'))
    expect(flip.evidence).toHaveLength(1)
    expect(flip.evidence[0]).toContain('capability:company.valuation')
    expect(flip.evidence[0]).toContain('run:run-valu-cur')
    expect(flip.evidence[0]).toMatch(/fetchedAt:\d+/)
    const confidence = findChange(diff, (c) => c.label === 'Confidence')
    expect(confidence.evidence.some((e) => e.includes('run:run-quote-cur'))).toBe(true)
  })

  it('computes the diff material flag from its changes', () => {
    const { previous, current } = fixturePair()
    const diff = buildDiff(previous, current)
    expect(diff.material).toBe(true)
    expect(diff.symbol).toBe('NVDA.US')
    expect(diff.previousReportId).toBe('report-prev')
    expect(diff.currentReportId).toBe('report-cur')
    expect(diff.generatedAt).toBe(current.generatedAt)
  })

  it('produces a stable deterministic id for a report pair', () => {
    const { previous, current } = fixturePair()
    const first = buildDiff(previous, current)
    const second = buildDiff(previous, current)
    expect(first.id).toBe(second.id)
    expect(first.id).toBe(diffIdFor('report-prev', 'report-cur'))
    expect(diffIdFor('a', 'b')).not.toBe(diffIdFor('b', 'a'))
  })

  it('returns no changes for identical reports', () => {
    const base = fixturePair().previous
    const diff = buildDiff(base, report('report-dup', { ...base, id: 'report-dup' }))
    expect(diff.changes).toEqual([])
    expect(diff.material).toBe(false)
  })

  it('does not diff summary prose', () => {
    const { previous, current } = fixturePair()
    const currentProse = { ...current, summary: 'A completely different summary text that changed.' }
    const diff = buildDiff(previous, currentProse)
    const verdictChanges = diff.changes.filter((c) => c.label === 'Verdict')
    expect(verdictChanges).toHaveLength(2)
    // The prose flip alone must not add a change.
    expect(diff.changes.some((c) => c.label === 'Summary')).toBe(false)
  })
})

describe('thesisImpactFromDiff', () => {
  it('invalidates a bullish thesis when a verdict flips negative', () => {
    const { previous, current } = fixturePair()
    const diff = buildDiff(previous, current)
    const impact = thesisImpactFromDiff(diff, { stance: 'bullish' })
    expect(impact.direction).toBe('invalidated')
    expect(impact.summary).toContain('flipped to negative')
  })

  it('strengthens a bullish thesis when a verdict flips positive', () => {
    const { previous, current } = fixturePair()
    // Valuation flips negative in the fixture; flip it back for this case.
    const previousSections = previous.sections.map((s) => (s.key === 'valuation' ? { ...s, verdict: 'negative' as const } : s))
    const currentSections = current.sections.map((s) => (s.key === 'valuation' ? { ...s, verdict: 'positive' as const } : s))
    const diff = buildDiff(
      { ...previous, sections: previousSections },
      { ...current, sections: currentSections },
      { thesis: { id: 't1', symbol: 'NVDA.US', stance: 'bullish', summary: '', bullCase: [], bearCase: [], catalysts: [], risks: [], evidenceRefs: [], createdAt: 0, updatedAt: 0, lastReviewedAt: 0 } }
    )
    expect(diff.thesisImpact?.direction).toBe('strengthened')
  })

  it('weakened when a verdict flips without a thesis stance to test', () => {
    const { previous, current } = fixturePair()
    const diff = buildDiff(previous, current)
    const impact = thesisImpactFromDiff(diff)
    expect(impact.direction).toBe('weakened')
  })

  it('weakened on a material new risk', () => {
    const previous = report('p', { risks: [] })
    const current = report('c', { risks: ['Regulatory scrutiny'], confidence: 0.5 })
    const diff = buildDiff(previous, current)
    expect(thesisImpactFromDiff(diff, { stance: 'bullish' }).direction).toBe('weakened')
  })

  it('strengthened on material improvements (price up ≥ 5%)', () => {
    const previous = report('p', {
      confidence: 0.5,
      sections: [section('technical', 'positive', 'Technical', 'Up', [evidence('market.quote', 'run-q1', '[up] NVDA.US: $100.00')])],
    })
    const current = report('c', {
      confidence: 0.5,
      sections: [section('technical', 'positive', 'Technical', 'Up', [evidence('market.quote', 'run-q2', '[up] NVDA.US: $112.00')])],
    })
    const diff = buildDiff(previous, current)
    const price = findChange(diff, (c) => c.label === 'Price')
    expect(price.material).toBe(true)
    expect(thesisImpactFromDiff(diff, { stance: 'bullish' }).direction).toBe('strengthened')
  })

  it('unchanged without any material change', () => {
    const base = report('p', { confidence: 0.5 })
    const diff = buildDiff(base, report('c', { confidence: 0.5 }))
    const impact = thesisImpactFromDiff(diff, { stance: 'bullish' })
    expect(impact.direction).toBe('unchanged')
  })

  it('renders the impact on the diff when a thesis is provided', () => {
    const { previous, current } = fixturePair()
    const diff = buildDiff(previous, current, {
      thesis: { id: 't1', symbol: 'NVDA.US', stance: 'bullish', summary: '', bullCase: [], bearCase: [], catalysts: [], risks: [], evidenceRefs: [], createdAt: 0, updatedAt: 0, lastReviewedAt: 0 },
    })
    expect(diff.thesisImpact).toBeDefined()
    expect(diff.thesisImpact?.direction).toBe('invalidated')
  })

  it('leaves thesisImpact undefined when no thesis exists', () => {
    const { previous, current } = fixturePair()
    expect(buildDiff(previous, current).thesisImpact).toBeUndefined()
  })
})
