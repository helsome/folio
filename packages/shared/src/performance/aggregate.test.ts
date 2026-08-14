import { describe, expect, it } from 'bun:test'
import {
  MIN_EVALUATED_SAMPLES,
  type PerformanceHorizon,
  type ResearchOpinion,
  type ResearchOutcome,
} from '@finagent/core'
import {
  aggregateSkillPerformance,
  aggregateStrategyPerformance,
} from './aggregate.ts'

/**
 * Pure aggregation tests (spec §36–38): horizon filtering, hit rate / average
 * return / unable-rate math, the MIN_EVALUATED_SAMPLES boundary, and
 * zero-sample safety (never NaN, never a fabricated 0%).
 */

function opinion(id: string, overrides: Partial<ResearchOpinion> = {}): ResearchOpinion {
  return {
    id,
    reportId: `report-${id}`,
    symbol: 'AAPL.US',
    skillIds: ['market-analysis'],
    stance: 'bullish',
    confidence: 0.8,
    horizon: '1m',
    createdAt: 1_800_000_000_000,
    evidenceRefs: [],
    ...overrides,
  }
}

function outcome(opinionId: string, overrides: Partial<ResearchOutcome> = {}): ResearchOutcome {
  return {
    id: `outcome-${opinionId}`,
    opinionId,
    horizon: '1m',
    evaluatedAt: 1_800_100_000_000,
    returnPercent: 2,
    directionCorrect: true,
    status: 'evaluated',
    outcomeEngineVersion: '1.0.0',
    ...overrides,
  }
}

/** `count` evaluated opinions for one skill, ids `g0..g{count-1}`. */
function group(count: number, skillId: string, horizon: PerformanceHorizon = '1m'): [ResearchOpinion[], ResearchOutcome[]] {
  const opinions: ResearchOpinion[] = []
  const outcomes: ResearchOutcome[] = []
  for (let i = 0; i < count; i += 1) {
    const id = `g${i}`
    opinions.push(opinion(id, { skillIds: [skillId], horizon }))
    outcomes.push(outcome(id, { horizon }))
  }
  return [opinions, outcomes]
}

describe('aggregateSkillPerformance', () => {
  it('filters to the requested horizon only', () => {
    const [opinions, outcomes] = group(2, 's1', '1w')
    opinions.push(opinion('m1', { skillIds: ['s1'], horizon: '1m' }))
    outcomes.push(outcome('m1', { horizon: '1m' }))

    const week = aggregateSkillPerformance(opinions, outcomes, '1w')
    const month = aggregateSkillPerformance(opinions, outcomes, '1m')

    expect(week).toHaveLength(1)
    expect(week[0].samples).toBe(2)
    expect(month).toHaveLength(1)
    expect(month[0].samples).toBe(1)
  })

  it('computes directionHitRate as correct over evaluated', () => {
    const opinions = [opinion('a'), opinion('b'), opinion('c')]
    const outcomes = [
      outcome('a', { directionCorrect: true }),
      outcome('b', { directionCorrect: false }),
      outcome('c', { directionCorrect: true }),
    ]
    const result = aggregateSkillPerformance(opinions, outcomes, '1m')
    expect(result).toHaveLength(1)
    expect(result[0].directionHitRate).toBeCloseTo(2 / 3)
    expect(result[0].samples).toBe(3)
    expect(result[0].insufficientData).toBe(true)
  })

  it('computes avgReturn as the mean of evaluated returnPercent only', () => {
    const opinions = [opinion('a'), opinion('b'), opinion('c')]
    const outcomes = [
      outcome('a', { returnPercent: 1 }),
      outcome('b', { returnPercent: 3 }),
      outcome('c', { status: 'unable', returnPercent: undefined, directionCorrect: undefined, reason: 'no-price-data' }),
    ]
    const result = aggregateSkillPerformance(opinions, outcomes, '1m')
    expect(result[0].avgReturn).toBeCloseTo(2)
    expect(result[0].samples).toBe(2)
  })

  it('computes unableRate as unable over total outcomes', () => {
    const opinions = [opinion('a'), opinion('b'), opinion('c'), opinion('d')]
    const outcomes = [
      outcome('a'),
      outcome('b'),
      outcome('c'),
      outcome('d', { status: 'unable', returnPercent: undefined, directionCorrect: undefined, reason: 'delisted' }),
    ]
    const result = aggregateSkillPerformance(opinions, outcomes, '1m')
    expect(result[0].unableRate).toBeCloseTo(0.25)
    expect(result[0].samples).toBe(3)
  })

  it('marks a group Observational Only below minSamples (29/30/31 boundary)', () => {
    const [twentyNine, twentyNineOut] = group(29, 's1')
    const [thirty, thirtyOut] = group(30, 's1')
    const [thirtyOne, thirtyOneOut] = group(31, 's1')

    const at29 = aggregateSkillPerformance(twentyNine, twentyNineOut, '1m')
    const at30 = aggregateSkillPerformance(thirty, thirtyOut, '1m')
    const at31 = aggregateSkillPerformance(thirtyOne, thirtyOneOut, '1m')

    expect(at29[0].insufficientData).toBe(true)
    expect(at30[0].insufficientData).toBe(false)
    expect(at31[0].insufficientData).toBe(false)
    expect(at29[0].samples).toBe(29)
    expect(at30[0].samples).toBe(30)
    expect(at31[0].samples).toBe(31)
  })

  it('supports a caller-supplied minSamples', () => {
    const [opinions, outcomes] = group(5, 's1')
    const result = aggregateSkillPerformance(opinions, outcomes, '1m', 5)
    expect(result[0].insufficientData).toBe(false)
  })

  it('is NaN-safe with zero opinions, zero outcomes, or only unable outcomes', () => {
    expect(aggregateSkillPerformance([], [], '1m')).toEqual([])

    const onlyUnable = [
      outcome('u', { status: 'unable', returnPercent: undefined, directionCorrect: undefined, reason: 'entry-unknown' }),
    ]
    const [emptyGroup] = aggregateSkillPerformance([opinion('u')], onlyUnable, '1m')
    expect(emptyGroup).toMatchObject({ samples: 0, insufficientData: true })
    expect(emptyGroup.directionHitRate).toBeUndefined()
    expect(emptyGroup.avgReturn).toBeUndefined()
    expect(emptyGroup.unableRate).toBe(1)
    expect(Number.isNaN(emptyGroup.directionHitRate)).toBe(false)
    expect(Number.isNaN(emptyGroup.avgReturn)).toBe(false)
  })

  it('skips orphan outcomes and deduplicates skill ids per opinion', () => {
    const opinions = [opinion('a', { skillIds: ['s1', 's1', 's2'] })]
    const outcomes = [outcome('a'), outcome('orphan')]
    const result = aggregateSkillPerformance(opinions, outcomes, '1m')
    expect(result).toHaveLength(2)
    expect(result.find((r) => r.skillId === 's1')?.samples).toBe(1)
    expect(result.find((r) => r.skillId === 's2')?.samples).toBe(1)
  })

  it('sorts groups by samples descending, then id', () => {
    const smallOpinions = [opinion('small-0', { skillIds: ['small'] })]
    const smallOutcomes = [outcome('small-0')]
    const bigOpinions = [opinion('big-0', { skillIds: ['big'] }), opinion('big-1', { skillIds: ['big'] }), opinion('big-2', { skillIds: ['big'] })]
    const result = aggregateSkillPerformance(
      [...smallOpinions, ...bigOpinions],
      [...smallOutcomes, ...bigOpinions.map((o) => outcome(o.id))],
      '1m'
    )
    expect(result.map((r) => r.skillId)).toEqual(['big', 'small'])
  })

  it('uses the default MIN_EVALUATED_SAMPLES constant', () => {
    expect(MIN_EVALUATED_SAMPLES).toBe(30)
    const [opinions, outcomes] = group(30, 's1')
    expect(aggregateSkillPerformance(opinions, outcomes, '1m')[0].insufficientData).toBe(false)
  })
})

describe('aggregateStrategyPerformance', () => {
  it('computes hitRate and medianExcessReturn (even count)', () => {
    const opinions = [
      opinion('a', { strategyId: 'value' }),
      opinion('b', { strategyId: 'value' }),
      opinion('c', { strategyId: 'value' }),
      opinion('d', { strategyId: 'value' }),
    ]
    const outcomes = [
      outcome('a', { returnPercent: 2, benchmarkReturn: 1, directionCorrect: true }),
      outcome('b', { returnPercent: -4, benchmarkReturn: -1, directionCorrect: false }),
      outcome('c', { returnPercent: 6, benchmarkReturn: 3, directionCorrect: true }),
      outcome('d', { returnPercent: 10, benchmarkReturn: 6, directionCorrect: true }),
    ]
    const result = aggregateStrategyPerformance(opinions, outcomes, '1m')
    expect(result).toHaveLength(1)
    expect(result[0].hitRate).toBeCloseTo(0.75)
    // excess: +1, −3, +3, +4 → sorted −3, 1, 3, 4 → median 2
    expect(result[0].medianExcessReturn).toBeCloseTo(2)
    expect(result[0].samples).toBe(4)
    expect(result[0].insufficientData).toBe(true)
  })

  it('computes medianExcessReturn for an odd count and skips pairs lacking benchmark', () => {
    const opinions = [
      opinion('a', { strategyId: 'growth' }),
      opinion('b', { strategyId: 'growth' }),
      opinion('c', { strategyId: 'growth' }),
    ]
    const outcomes = [
      outcome('a', { returnPercent: 10, benchmarkReturn: 4 }),
      outcome('b', { returnPercent: 8, benchmarkReturn: 2 }),
      outcome('c', { returnPercent: 5 }), // no benchmark → excluded from excess
    ]
    const result = aggregateStrategyPerformance(opinions, outcomes, '1m')
    // excess: +6, +6 → median 6
    expect(result[0].medianExcessReturn).toBeCloseTo(6)
    expect(result[0].samples).toBe(3)
  })

  it('filters by horizon and skips opinions without a strategyId', () => {
    const opinions = [
      opinion('a', { strategyId: 'technical', horizon: '1w' }),
      opinion('b', { strategyId: 'technical', horizon: '1m' }),
      opinion('c'), // no strategy attribution
    ]
    const outcomes = [outcome('a', { horizon: '1w' }), outcome('b', { horizon: '1m' }), outcome('c')]
    const week = aggregateStrategyPerformance(opinions, outcomes, '1w')
    expect(week).toHaveLength(1)
    expect(week[0].samples).toBe(1)
  })

  it('is NaN-safe with zero outcomes for the horizon', () => {
    const result = aggregateStrategyPerformance([], [], '3m')
    expect(result).toEqual([])
  })

  it('keeps unable outcomes out of hit rate and samples', () => {
    const opinions = [opinion('a', { strategyId: 'income' }), opinion('b', { strategyId: 'income' })]
    const outcomes = [
      outcome('a', { directionCorrect: true }),
      outcome('b', { status: 'unable', returnPercent: undefined, directionCorrect: undefined, reason: 'no-price-data' }),
    ]
    const result = aggregateStrategyPerformance(opinions, outcomes, '1m')
    expect(result[0].hitRate).toBeCloseTo(1)
    expect(result[0].samples).toBe(1)
  })
})
