import { describe, expect, it } from 'bun:test'
import { OUTCOME_ENGINE_VERSION } from '@finagent/core'
import {
  directionCorrectFor,
  expectationFor,
  HORIZON_MS,
  maxDrawdownPct,
  OutcomeEngine,
} from './engine.ts'
import { dailyBars, makeKline, makeOpinion, NOW_MS } from './test-helpers.ts'

const engine = new OutcomeEngine()
const DAY_SEC = 24 * 60 * 60
const startSec = Math.floor(NOW_MS / 1000)

describe('OutcomeEngine direction matrix', () => {
  it('bullish up → directionCorrect', () => {
    const opinion = makeOpinion({ stance: 'bullish', entryPrice: 100 })
    const outcome = engine.evaluate(opinion, dailyBars(startSec, [100, 104, 108, 112, 116]))
    expect(outcome.status).toBe('evaluated')
    expect(outcome.entryPrice).toBe(100)
    expect(outcome.exitPrice).toBe(116)
    expect(outcome.returnPercent).toBeCloseTo(16, 5)
    expect(outcome.directionCorrect).toBe(true)
  })

  it('bullish down → incorrect', () => {
    const opinion = makeOpinion({ stance: 'bullish', entryPrice: 100 })
    const outcome = engine.evaluate(opinion, dailyBars(startSec, [100, 96, 92, 88, 84]))
    expect(outcome.returnPercent).toBeCloseTo(-16, 5)
    expect(outcome.directionCorrect).toBe(false)
  })

  it('bearish down → directionCorrect', () => {
    const opinion = makeOpinion({ stance: 'bearish', entryPrice: 100 })
    const outcome = engine.evaluate(opinion, dailyBars(startSec, [100, 96, 92, 88, 84]))
    expect(outcome.returnPercent).toBeCloseTo(-16, 5)
    expect(outcome.directionCorrect).toBe(true)
  })

  it('bearish up → incorrect', () => {
    const opinion = makeOpinion({ stance: 'bearish', entryPrice: 100 })
    const outcome = engine.evaluate(opinion, dailyBars(startSec, [100, 104, 108, 112, 116]))
    expect(outcome.directionCorrect).toBe(false)
  })

  it('neutral bounded: small move is correct, big move is incorrect', () => {
    expect(
      engine.evaluate(makeOpinion({ stance: 'neutral' }), dailyBars(startSec, [100, 101.5]))
        .directionCorrect
    ).toBe(true)
    expect(
      engine.evaluate(makeOpinion({ stance: 'neutral' }), dailyBars(startSec, [100, 105]))
        .directionCorrect
    ).toBe(false)
  })

  it('unbounded neutral makes no directional claim', () => {
    expect(directionCorrectFor('neutral', 5, { kind: 'neutral', bounded: false })).toBeUndefined()
  })

  it('expectationFor maps each stance', () => {
    expect(expectationFor('bullish')).toEqual({ kind: 'bullish', positiveReturn: true })
    expect(expectationFor('bearish')).toEqual({ kind: 'bearish', negativeReturn: true })
    expect(expectationFor('neutral')).toEqual({ kind: 'neutral', bounded: true })
  })
})

describe('OutcomeEngine entry and exit resolution', () => {
  it('falls back to the first history close when the opinion has no entryPrice', () => {
    const opinion = makeOpinion({ entryPrice: undefined })
    const outcome = engine.evaluate(opinion, dailyBars(startSec, [50, 55]))
    expect(outcome.status).toBe('evaluated')
    expect(outcome.entryPrice).toBe(50)
    expect(outcome.returnPercent).toBeCloseTo(10, 5)
  })

  it('exits at the close of the last bar at-or-before the horizon end', () => {
    const opinion = makeOpinion({ horizon: '1w' })
    const closes = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110]
    const outcome = engine.evaluate(opinion, dailyBars(startSec, closes))
    // Horizon end = NOW_MS + 7d → last bar within the window is day 7 (107).
    expect(outcome.exitPrice).toBe(107)
    expect(outcome.returnPercent).toBeCloseTo(7, 5)
  })

  it('uses the last available close when the series is shorter than the horizon', () => {
    const opinion = makeOpinion({ horizon: '1m', entryPrice: 100 })
    const outcome = engine.evaluate(opinion, dailyBars(startSec, [100, 102, 104, 106]))
    expect(outcome.status).toBe('evaluated')
    expect(outcome.exitPrice).toBe(106)
    expect(outcome.returnPercent).toBeCloseTo(6, 5)
  })

  it('sorts descending input defensively', () => {
    const opinion = makeOpinion({ entryPrice: 100 })
    const descending = dailyBars(startSec, [100, 104, 108, 112, 116]).reverse()
    const outcome = engine.evaluate(opinion, descending)
    expect(outcome.exitPrice).toBe(116)
    expect(outcome.returnPercent).toBeCloseTo(16, 5)
  })
})

describe('OutcomeEngine drawdown', () => {
  it('computes peak-to-trough drawdown as positive percent', () => {
    const outcome = engine.evaluate(makeOpinion(), dailyBars(startSec, [100, 90, 110, 80]))
    expect(outcome.maximumDrawdown).toBeCloseTo(27.2727, 1)
  })

  it('returns 0 for a monotonically rising series', () => {
    const outcome = engine.evaluate(makeOpinion(), dailyBars(startSec, [100, 110, 120, 130]))
    expect(outcome.maximumDrawdown).toBe(0)
  })

  it('measures intra-horizon closes only (ignores post-horizon dips)', () => {
    const opinion = makeOpinion({ horizon: '1w' })
    // Window ends at day 7 (123); the crash to 60 lands after the horizon.
    const closes = [100, 105, 110, 115, 120, 121, 122, 123, 60, 61, 62]
    const outcome = engine.evaluate(opinion, dailyBars(startSec, closes))
    expect(outcome.exitPrice).toBe(123)
    expect(outcome.maximumDrawdown).toBe(0)
  })

  it('maxDrawdownPct handles a flat series', () => {
    expect(maxDrawdownPct([50, 50, 50])).toBe(0)
  })
})

describe('OutcomeEngine unable paths', () => {
  it('no history and no entry → unable entry-unknown', () => {
    const opinion = makeOpinion({ entryPrice: undefined })
    const outcome = engine.evaluate(opinion, null, { now: 12345 })
    expect(outcome.status).toBe('unable')
    expect(outcome.reason).toBe('entry-unknown')
    expect(outcome.entryPrice).toBeUndefined()
    expect(outcome.evaluatedAt).toBe(12345)
    expect(outcome.outcomeEngineVersion).toBe(OUTCOME_ENGINE_VERSION)
    expect(outcome.horizon).toBe(opinion.horizon)
  })

  it('empty history with a known entry → unable no-price-data', () => {
    const outcome = engine.evaluate(makeOpinion({ entryPrice: 100 }), [], { now: 12345 })
    expect(outcome.status).toBe('unable')
    expect(outcome.reason).toBe('no-price-data')
    expect(outcome.entryPrice).toBe(100)
  })

  it('null history with a known entry → unable no-price-data', () => {
    const outcome = engine.evaluate(makeOpinion({ entryPrice: 100 }), null)
    expect(outcome.reason).toBe('no-price-data')
  })

  it('series that never reaches the horizon end → unable delisted', () => {
    // All bars start 8 days after creation; horizon is 1w → no bar ≤ horizon end.
    const opinion = makeOpinion({ horizon: '1w', entryPrice: 100 })
    const bars = dailyBars(startSec + 8 * DAY_SEC, [100, 101, 102])
    const outcome = engine.evaluate(opinion, bars)
    expect(outcome.status).toBe('unable')
    expect(outcome.reason).toBe('delisted')
    expect(outcome.entryPrice).toBe(100)
  })

  it('non-positive entry derived from history → unable entry-unknown', () => {
    const opinion = makeOpinion({ entryPrice: undefined })
    const outcome = engine.evaluate(opinion, [makeKline(startSec, 0)])
    expect(outcome.status).toBe('unable')
    expect(outcome.reason).toBe('entry-unknown')
  })
})

describe('OutcomeEngine stamping', () => {
  it('stamps OUTCOME_ENGINE_VERSION by default and honors an override', () => {
    const bars = dailyBars(startSec, [100, 110])
    expect(engine.evaluate(makeOpinion(), bars).outcomeEngineVersion).toBe(OUTCOME_ENGINE_VERSION)
    expect(engine.evaluate(makeOpinion(), bars, { version: '2.0.0' }).outcomeEngineVersion).toBe(
      '2.0.0'
    )
  })

  it('records benchmarkReturn only when provided (never fabricated)', () => {
    const bars = dailyBars(startSec, [100, 110])
    const withoutBenchmark = engine.evaluate(makeOpinion(), bars)
    expect(withoutBenchmark.benchmarkReturn).toBeUndefined()
    const withBenchmark = engine.evaluate(makeOpinion(), bars, { benchmarkReturn: 4.2 })
    expect(withBenchmark.benchmarkReturn).toBe(4.2)
  })

  it('uses options.now as evaluatedAt', () => {
    const outcome = engine.evaluate(makeOpinion(), dailyBars(startSec, [100, 110]), { now: 777 })
    expect(outcome.evaluatedAt).toBe(777)
  })

  it('exposes horizon constants', () => {
    expect(HORIZON_MS['1w']).toBe(7 * 24 * 60 * 60 * 1000)
    expect(HORIZON_MS['1m']).toBe(30 * 24 * 60 * 60 * 1000)
    expect(HORIZON_MS['3m']).toBe(90 * 24 * 60 * 60 * 1000)
  })
})
