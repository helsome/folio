import { describe, expect, it } from 'bun:test'
import { createOpinion, extractEntryPrice, OPINION_DEFAULT_HORIZON } from './opinions.ts'
import { makeBareReport, makeReport, NOW_MS } from './test-helpers.ts'

describe('createOpinion', () => {
  it('maps report fields onto the opinion', () => {
    const opinion = createOpinion(makeReport(), { now: NOW_MS, provider: 'longbridge' })

    expect(opinion.id).toBe('opinion-report-r1')
    expect(opinion.reportId).toBe('report-r1')
    expect(opinion.symbol).toBe('AAPL.US')
    expect(opinion.strategyId).toBe('value')
    expect(opinion.stance).toBe('bullish')
    expect(opinion.confidence).toBe(0.8)
    expect(opinion.horizon).toBe('1m')
    expect(opinion.createdAt).toBe(NOW_MS)
    expect(opinion.provider).toBe('longbridge')
  })

  it('defaults horizon to 1m and honors the option', () => {
    expect(OPINION_DEFAULT_HORIZON).toBe('1m')
    expect(createOpinion(makeReport(), { now: NOW_MS }).horizon).toBe('1m')
    expect(createOpinion(makeReport(), { now: NOW_MS, horizon: '3m' }).horizon).toBe('3m')
  })

  it('defaults createdAt to Date.now() when now is omitted', () => {
    const before = Date.now()
    const opinion = createOpinion(makeReport())
    const after = Date.now()
    expect(opinion.createdAt).toBeGreaterThanOrEqual(before)
    expect(opinion.createdAt).toBeLessThanOrEqual(after)
  })

  it('snapshots entry price from quote-capability evidence', () => {
    const opinion = createOpinion(makeReport(), { now: NOW_MS })
    expect(opinion.entryPrice).toBe(150)
  })

  it('leaves entryPrice undefined when the report carries no quote value', () => {
    expect(createOpinion(makeBareReport(), { now: NOW_MS }).entryPrice).toBeUndefined()
    expect(extractEntryPrice(makeBareReport())).toBeUndefined()
  })

  it('sets dataTimestamp to the newest capability run fetchedAt', () => {
    const opinion = createOpinion(makeReport(), { now: NOW_MS })
    expect(opinion.dataTimestamp).toBe(NOW_MS - 10_000)
  })

  it('leaves dataTimestamp undefined when there are no capability runs', () => {
    expect(createOpinion(makeBareReport(), { now: NOW_MS }).dataTimestamp).toBeUndefined()
  })

  it('collects unique evidence run ids in section order', () => {
    const opinion = createOpinion(makeReport(), { now: NOW_MS })
    expect(opinion.evidenceRefs).toEqual(['run-quote', 'run-valuation'])
  })

  it('maps skill lineage from the strategy preset', () => {
    // makeReport uses strategyId 'value' → the value preset's skillIds.
    const opinion = createOpinion(makeReport(), { now: NOW_MS })
    expect(opinion.skillIds).toEqual(['longbridge-fundamentals', 'longbridge-value-investing'])
  })

  it('records no skill lineage for unknown or missing strategies', () => {
    expect(
      createOpinion(makeReport({ strategyId: 'momentum' }), { now: NOW_MS }).skillIds
    ).toEqual([])
    expect(
      createOpinion(makeReport({ strategyId: undefined }), { now: NOW_MS }).skillIds
    ).toEqual([])
  })
})
