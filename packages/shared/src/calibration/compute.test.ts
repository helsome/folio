import { describe, expect, it } from 'bun:test'
import {
  BASE_WEIGHT,
  MIN_CALIBRATION_SAMPLES,
  WEIGHT_BOUNDS,
  type PerformanceHorizon,
  type ResearchOpinion,
  type ResearchOutcome,
} from '@finagent/core'
import {
  RELIABILITY_SENSITIVITY,
  SAMPLE_CONFIDENCE_FULL_SAMPLES,
  UNABLE_PENALTY_MAX_RATE,
  computeSkillCalibrations,
  computeStrategyCalibrations,
} from './compute.ts'

/**
 * Pure calibration tests (spec §39–42): reliability math, the
 * WEIGHT_BOUNDS clamp (weights are NEVER unbounded), the sample-confidence
 * ramp, the unable-penalty cap, insufficient-data nulling, and determinism.
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

/** `count` evaluated opinions for one skill, ids `<skillId>-g0..g{count-1}`. */
function group(
  count: number,
  skillId: string,
  horizon: PerformanceHorizon = '1m'
): [ResearchOpinion[], ResearchOutcome[]] {
  const opinions: ResearchOpinion[] = []
  const outcomes: ResearchOutcome[] = []
  for (let i = 0; i < count; i += 1) {
    const id = `${skillId}-g${i}`
    opinions.push(opinion(id, { skillIds: [skillId], horizon }))
    outcomes.push(outcome(id, { horizon }))
  }
  return [opinions, outcomes]
}

/** `count` evaluated opinions for one strategy, ids `<strategyId>-g0..g{count-1}`. */
function strategyGroup(
  count: number,
  strategyId: string,
  horizon: PerformanceHorizon = '1m'
): [ResearchOpinion[], ResearchOutcome[]] {
  const opinions: ResearchOpinion[] = []
  const outcomes: ResearchOutcome[] = []
  for (let i = 0; i < count; i += 1) {
    const id = `${strategyId}-g${i}`
    opinions.push(opinion(id, { strategyId, horizon }))
    outcomes.push(outcome(id, { horizon }))
  }
  return [opinions, outcomes]
}

/** Expected unbounded raw weight from the documented formula. */
function rawWeight(reliability: number, unablePenalty: number): number {
  return BASE_WEIGHT + (reliability - 0.5) * RELIABILITY_SENSITIVITY - unablePenalty
}

describe('computeSkillCalibrations', () => {
  it('computes reliability as correct over evaluated and the bounded weight formula', () => {
    // 40 evaluated: 30 correct, 10 wrong → reliability 0.75, confidence 0.4.
    const [opinions, outcomes] = group(40, 's1')
    for (let i = 0; i < 10; i += 1) {
      outcomes[i].directionCorrect = false
    }
    const result = computeSkillCalibrations(opinions, outcomes, '1m')

    expect(result).toHaveLength(1)
    const cal = result[0]
    expect(cal.skillId).toBe('s1')
    expect(cal.samples).toBe(40)
    expect(cal.insufficientData).toBe(false)
    expect(cal.historicalReliability).toBeCloseTo(0.75)
    expect(cal.sampleConfidence).toBeCloseTo(40 / SAMPLE_CONFIDENCE_FULL_SAMPLES)
    expect(cal.unablePenalty).toBeCloseTo(0)
    expect(cal.baseWeight).toBe(BASE_WEIGHT)
    expect(cal.finalBoundedWeight).toBeCloseTo(rawWeight(0.75, 0))
  })

  it('clamps an over-performing skill to the max bound (never above 1.25)', () => {
    // All 40 correct → raw 1.25; a future reliability > 1 would still clamp.
    const [opinions, outcomes] = group(40, 's1')
    const result = computeSkillCalibrations(opinions, outcomes, '1m')
    expect(result[0].historicalReliability).toBe(1)
    expect(result[0].finalBoundedWeight).toBeCloseTo(WEIGHT_BOUNDS.max)
    expect(result[0].finalBoundedWeight).toBeLessThanOrEqual(WEIGHT_BOUNDS.max)
  })

  it('clamps a failing skill to the min bound (never below 0.75)', () => {
    // 30 all wrong + 30 unable → raw = 0.75 − 0.025 = 0.725 → clamped to 0.75.
    const [opinions, outcomes] = group(30, 's1')
    for (let i = 0; i < 30; i += 1) {
      outcomes[i].directionCorrect = false
    }
    for (let i = 0; i < 30; i += 1) {
      const id = `u${i}`
      opinions.push(opinion(id, { skillIds: ['s1'] }))
      outcomes.push(
        outcome(id, {
          status: 'unable',
          returnPercent: undefined,
          directionCorrect: undefined,
          reason: 'no-price-data',
        })
      )
    }
    const result = computeSkillCalibrations(opinions, outcomes, '1m')
    expect(result[0].samples).toBe(30)
    expect(result[0].historicalReliability).toBe(0)
    expect(result[0].unablePenalty).toBeCloseTo(0.5 * UNABLE_PENALTY_MAX_RATE)
    expect(result[0].finalBoundedWeight).toBeCloseTo(WEIGHT_BOUNDS.min)
    expect(result[0].finalBoundedWeight).toBeGreaterThanOrEqual(WEIGHT_BOUNDS.min)
  })

  it('respects caller-supplied bounds', () => {
    const [opinions, outcomes] = group(40, 's1') // reliability 1 → raw 1.25
    const tight = computeSkillCalibrations(opinions, outcomes, '1m', { min: 0.9, max: 1.1 })
    expect(tight[0].finalBoundedWeight).toBeCloseTo(1.1)
  })

  it('ramps sample confidence from 30 samples to full at 100', () => {
    const [at30, at30Out] = group(30, 's1')
    const [at50, at50Out] = group(50, 's2')
    const [at100, at100Out] = group(100, 's3')
    const [at150, at150Out] = group(150, 's4')

    const result = computeSkillCalibrations(
      [...at30, ...at50, ...at100, ...at150],
      [...at30Out, ...at50Out, ...at100Out, ...at150Out],
      '1m'
    )
    const byId = new Map(result.map((cal) => [cal.skillId, cal]))
    expect(byId.get('s1')?.sampleConfidence).toBeCloseTo(0.3)
    expect(byId.get('s2')?.sampleConfidence).toBeCloseTo(0.5)
    expect(byId.get('s3')?.sampleConfidence).toBe(1)
    // Past full confidence the ramp stays capped at 1.
    expect(byId.get('s4')?.sampleConfidence).toBe(1)
  })

  it('applies the unable penalty as unableRate × 5%, capped at 5%', () => {
    // 30 correct + 30 unable → unableRate 0.5 → penalty 0.025.
    const [opinions, outcomes] = group(30, 's1')
    for (let i = 0; i < 30; i += 1) {
      const id = `u${i}`
      opinions.push(opinion(id, { skillIds: ['s1'] }))
      outcomes.push(
        outcome(id, {
          status: 'unable',
          returnPercent: undefined,
          directionCorrect: undefined,
          reason: 'delisted',
        })
      )
    }
    const result = computeSkillCalibrations(opinions, outcomes, '1m')
    expect(result[0].unablePenalty).toBeCloseTo(0.5 * UNABLE_PENALTY_MAX_RATE)
    expect(result[0].finalBoundedWeight).toBeCloseTo(rawWeight(1, 0.5 * UNABLE_PENALTY_MAX_RATE))

    // Even with an overwhelming unable share the penalty never exceeds 5%.
    const [opinions2, outcomes2] = group(30, 's1')
    for (let i = 0; i < 3000; i += 1) {
      const id = `u${i}`
      opinions2.push(opinion(id, { skillIds: ['s1'] }))
      outcomes2.push(
        outcome(id, {
          status: 'unable',
          returnPercent: undefined,
          directionCorrect: undefined,
          reason: 'delisted',
        })
      )
    }
    const capped = computeSkillCalibrations(opinions2, outcomes2, '1m')
    expect(capped[0].unablePenalty ?? 0).toBeLessThanOrEqual(UNABLE_PENALTY_MAX_RATE)
    expect(capped[0].unablePenalty ?? 0).toBeCloseTo(
      Math.min(UNABLE_PENALTY_MAX_RATE, (3000 / 3030) * UNABLE_PENALTY_MAX_RATE),
      6
    )
  })

  it('nulls every derived number below MIN_CALIBRATION_SAMPLES (Observational Only)', () => {
    const [at29, at29Out] = group(MIN_CALIBRATION_SAMPLES - 1, 's1')
    const [at30, at30Out] = group(MIN_CALIBRATION_SAMPLES, 's1')

    const below = computeSkillCalibrations(at29, at29Out, '1m')
    expect(below[0].samples).toBe(MIN_CALIBRATION_SAMPLES - 1)
    expect(below[0].insufficientData).toBe(true)
    expect(below[0].historicalReliability).toBeNull()
    expect(below[0].sampleConfidence).toBeNull()
    expect(below[0].unablePenalty).toBeNull()
    expect(below[0].finalBoundedWeight).toBeNull()
    expect(below[0].baseWeight).toBe(BASE_WEIGHT)

    const atBoundary = computeSkillCalibrations(at30, at30Out, '1m')
    expect(atBoundary[0].insufficientData).toBe(false)
    expect(atBoundary[0].historicalReliability).toBe(1)
    expect(atBoundary[0].finalBoundedWeight).toBeCloseTo(WEIGHT_BOUNDS.max)
  })

  it('is NaN-safe and returns [] for zero opinions, zero outcomes, or only unable outcomes', () => {
    expect(computeSkillCalibrations([], [], '1m')).toEqual([])

    const [opinions, outcomes] = group(30, 's1')
    for (let i = 0; i < 30; i += 1) {
      outcomes[i] = outcome(opinions[i].id, {
        status: 'unable',
        returnPercent: undefined,
        directionCorrect: undefined,
        reason: 'no-price-data',
      })
    }
    const onlyUnable = computeSkillCalibrations(opinions, outcomes, '1m')
    expect(onlyUnable).toHaveLength(1)
    expect(onlyUnable[0].samples).toBe(0)
    expect(onlyUnable[0].insufficientData).toBe(true)
    expect(onlyUnable[0].finalBoundedWeight).toBeNull()
  })

  it('filters to the requested horizon and skips orphan outcomes', () => {
    const [opinions, outcomes] = group(30, 's1', '1w')
    opinions.push(opinion('m1', { skillIds: ['s1'], horizon: '1m' }))
    outcomes.push(outcome('m1', { horizon: '1m' }))
    outcomes.push(outcome('orphan')) // no matching opinion

    const week = computeSkillCalibrations(opinions, outcomes, '1w')
    const month = computeSkillCalibrations(opinions, outcomes, '1m')
    expect(week).toHaveLength(1)
    expect(week[0].samples).toBe(30)
    expect(month).toHaveLength(1)
    expect(month[0].samples).toBe(1)
  })

  it('deduplicates skill ids per opinion for multi-skill opinions', () => {
    const opinions = [opinion('a', { skillIds: ['s1', 's2', 's1'] })]
    const outcomes = [outcome('a')]
    const result = computeSkillCalibrations(opinions, outcomes, '1m')
    expect(result).toHaveLength(2)
    expect(result.map((cal) => cal.skillId).sort()).toEqual(['s1', 's2'])
    expect(result.every((cal) => cal.samples === 1 && cal.insufficientData)).toBe(true)
  })

  it('is deterministic: input order does not change the output', () => {
    const [opinions, outcomes] = group(40, 's1')
    for (let i = 10; i < 40; i += 1) {
      outcomes[i].directionCorrect = false
    }
    opinions.push(opinion('x1', { skillIds: ['s2'] }))
    outcomes.push(outcome('x1'))
    const shuffledOpinions = [...opinions].reverse()
    const shuffledOutcomes = [...outcomes].reverse()

    const first = computeSkillCalibrations(opinions, outcomes, '1m')
    const second = computeSkillCalibrations(shuffledOpinions, shuffledOutcomes, '1m')
    expect(second).toEqual(first)
  })

  it('sorts groups by samples descending, then id', () => {
    const [small, smallOut] = group(5, 'beta')
    const [large, largeOut] = group(40, 'alpha')
    const result = computeSkillCalibrations(
      [...small, ...large],
      [...smallOut, ...largeOut],
      '1m'
    )
    expect(result.map((cal) => cal.skillId)).toEqual(['alpha', 'beta'])
  })
})

describe('computeStrategyCalibrations', () => {
  it('mirrors the skill math with the strategyId variant', () => {
    const [opinions, outcomes] = strategyGroup(40, 'value')
    for (let i = 0; i < 10; i += 1) {
      outcomes[i].directionCorrect = false
    }
    const result = computeStrategyCalibrations(opinions, outcomes, '1m')

    expect(result).toHaveLength(1)
    const cal = result[0]
    expect(cal.strategyId).toBe('value')
    expect(cal.samples).toBe(40)
    expect(cal.insufficientData).toBe(false)
    expect(cal.historicalReliability).toBeCloseTo(0.75)
    expect(cal.sampleConfidence).toBeCloseTo(0.4)
    expect(cal.finalBoundedWeight).toBeCloseTo(rawWeight(0.75, 0))
  })

  it('skips opinions without a strategy attribution', () => {
    const [opinions, outcomes] = strategyGroup(30, 'growth')
    opinions.push(opinion('naked')) // no strategyId
    outcomes.push(outcome('naked'))
    const result = computeStrategyCalibrations(opinions, outcomes, '1m')
    expect(result).toHaveLength(1)
    expect(result[0].strategyId).toBe('growth')
    expect(result[0].samples).toBe(30)
  })

  it('clamps to the same bounds and nulls below min samples', () => {
    const [below, belowOut] = strategyGroup(10, 'income')
    const [perfect, perfectOut] = strategyGroup(40, 'technical')
    const result = computeStrategyCalibrations(
      [...below, ...perfect],
      [...belowOut, ...perfectOut],
      '1m'
    )
    const byId = new Map(result.map((cal) => [cal.strategyId, cal]))
    expect(byId.get('income')?.insufficientData).toBe(true)
    expect(byId.get('income')?.finalBoundedWeight).toBeNull()
    expect(byId.get('technical')?.finalBoundedWeight).toBeCloseTo(WEIGHT_BOUNDS.max)
    expect(byId.get('technical')?.finalBoundedWeight).toBeLessThanOrEqual(WEIGHT_BOUNDS.max)
  })

  it('is deterministic', () => {
    const [opinions, outcomes] = strategyGroup(35, 'value')
    const first = computeStrategyCalibrations(opinions, outcomes, '1m')
    const second = computeStrategyCalibrations([...opinions].reverse(), [...outcomes].reverse(), '1m')
    expect(second).toEqual(first)
  })
})
