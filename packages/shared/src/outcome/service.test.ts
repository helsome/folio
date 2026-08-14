import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { Kline } from '@finagent/core'
import { JsonFileStore } from '../storage/json-file-store.ts'
import { HORIZON_MS } from './engine.ts'
import { OutcomeRepository } from './repository.ts'
import { OutcomeService } from './service.ts'
import { dailyBars, makeOpinion, makeReport, NOW_MS } from './test-helpers.ts'

let dir = ''
let repository: OutcomeRepository
let service: OutcomeService

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'finagent-outcome-svc-'))
  repository = new OutcomeRepository(new JsonFileStore(dir))
  service = new OutcomeService({ repository, now: () => NOW_MS })
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function dueOpinion(id: string, symbol: string, overrides: Partial<Parameters<typeof makeOpinion>[0]> = {}) {
  return makeOpinion({
    id,
    symbol,
    reportId: `report-${id}`,
    createdAt: NOW_MS - HORIZON_MS['1m'] - 1000,
    ...overrides,
  })
}

/** Bars anchored at the due opinion's creation so they fall inside the horizon. */
function barsForDue(closes: number[]): Kline[] {
  const createdAtSec = Math.floor((NOW_MS - HORIZON_MS['1m'] - 1000) / 1000)
  return dailyBars(createdAtSec, closes)
}

describe('OutcomeService.createOpinionFromReport', () => {
  it('persists the opinion and round-trips it', async () => {
    const saved = await service.createOpinionFromReport(makeReport())
    expect(saved.id).toBe('opinion-report-r1')
    expect(saved.stance).toBe('bullish')
    expect(saved.entryPrice).toBe(150)
    expect(await repository.getOpinion(saved.id)).toEqual(saved)
  })

  it('is idempotent per report', async () => {
    const report = makeReport()
    await service.createOpinionFromReport(report)
    await service.createOpinionFromReport(report)
    expect(await repository.listOpinions()).toHaveLength(1)
  })
})

describe('OutcomeService.evaluateDue', () => {
  it('evaluates due opinions with the injected fetcher and stores outcomes', async () => {
    const aapl = dueOpinion('opinion-aapl', 'AAPL.US', { entryPrice: 100 })
    const msft = dueOpinion('opinion-msft', 'MSFT.US', { entryPrice: 50 })
    await repository.saveOpinion(aapl)
    await repository.saveOpinion(msft)

    const fetcher = async (symbol: string): Promise<Kline[] | null> => {
      if (symbol === 'AAPL.US') return barsForDue([100, 110])
      return barsForDue([50, 45])
    }

    const outcomes = await service.evaluateDue(NOW_MS, fetcher)

    expect(outcomes).toHaveLength(2)
    const byOpinion = new Map(outcomes.map((o) => [o.opinionId, o]))
    expect(byOpinion.get('opinion-aapl')?.returnPercent).toBeCloseTo(10, 5)
    expect(byOpinion.get('opinion-aapl')?.directionCorrect).toBe(true)
    expect(byOpinion.get('opinion-msft')?.returnPercent).toBeCloseTo(-10, 5)
    expect(byOpinion.get('opinion-msft')?.directionCorrect).toBe(false)
    expect(byOpinion.get('opinion-msft')?.evaluatedAt).toBe(NOW_MS)

    // Round-trip: outcomes are persisted and no longer due.
    expect(await repository.getOutcomeByOpinionId('opinion-aapl')).toBeDefined()
    expect(await repository.listDueOpinions(NOW_MS)).toEqual([])
  })

  it('returns [] without an injected fetcher (documented no-op)', async () => {
    await repository.saveOpinion(dueOpinion('opinion-aapl', 'AAPL.US'))
    expect(await service.evaluateDue(NOW_MS)).toEqual([])
    expect(await repository.listDueOpinions(NOW_MS)).toHaveLength(1)
  })

  it('fetches history once per symbol across due opinions', async () => {
    await repository.saveOpinion(dueOpinion('opinion-a1', 'AAPL.US'))
    await repository.saveOpinion(dueOpinion('opinion-a2', 'AAPL.US'))
    await repository.saveOpinion(dueOpinion('opinion-m1', 'MSFT.US'))

    let fetches = 0
    const fetcher = async (): Promise<Kline[] | null> => {
      fetches += 1
      return barsForDue([100, 110])
    }

    const outcomes = await service.evaluateDue(NOW_MS, fetcher)
    expect(outcomes).toHaveLength(3)
    expect(fetches).toBe(2)
  })

  it('does not evaluate opinions that are not due yet', async () => {
    await repository.saveOpinion(makeOpinion({ id: 'opinion-young', createdAt: NOW_MS - 1000 }))
    const fetcher = async (): Promise<Kline[] | null> => barsForDue([100, 110])
    expect(await service.evaluateDue(NOW_MS, fetcher)).toEqual([])
  })

  it('stores an unable outcome when the fetcher returns null', async () => {
    await repository.saveOpinion(dueOpinion('opinion-null', 'AAPL.US'))
    const fetcher = async (): Promise<Kline[] | null> => null
    const outcomes = await service.evaluateDue(NOW_MS, fetcher)
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0].status).toBe('unable')
    expect(outcomes[0].reason).toBe('no-price-data')
    expect(await repository.getOutcomeByOpinionId('opinion-null')).toBeDefined()
  })
})
