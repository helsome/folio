import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { ResearchOutcome } from '@finagent/core'
import { JsonFileStore } from '../storage/json-file-store.ts'
import { HORIZON_MS } from './engine.ts'
import { OutcomeRepository } from './repository.ts'
import { makeOpinion, NOW_MS } from './test-helpers.ts'

let dir = ''
let repository: OutcomeRepository

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'finagent-outcome-'))
  repository = new OutcomeRepository(new JsonFileStore(dir))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function outcomeFor(opinionId: string, overrides: Partial<ResearchOutcome> = {}): ResearchOutcome {
  return {
    id: `outcome-${opinionId}`,
    opinionId,
    horizon: '1m',
    evaluatedAt: NOW_MS + HORIZON_MS['1m'],
    entryPrice: 100,
    exitPrice: 110,
    returnPercent: 10,
    directionCorrect: true,
    maximumDrawdown: 2.5,
    status: 'evaluated',
    outcomeEngineVersion: '1.0.0',
    ...overrides,
  }
}

describe('OutcomeRepository opinions', () => {
  it('saves and reads back an opinion', async () => {
    const opinion = makeOpinion()
    await repository.saveOpinion(opinion)
    expect(await repository.getOpinion(opinion.id)).toEqual(opinion)
    expect(await repository.listOpinions()).toEqual([opinion])
  })

  it('upserts by id and keeps newest first', async () => {
    const first = makeOpinion({ id: 'opinion-a', symbol: 'AAPL.US' })
    const second = makeOpinion({ id: 'opinion-b', symbol: 'MSFT.US' })
    await repository.saveOpinion(first)
    await repository.saveOpinion(second)
    await repository.saveOpinion({ ...first, stance: 'bearish' })

    const opinions = await repository.listOpinions()
    expect(opinions.map((o) => o.id)).toEqual(['opinion-a', 'opinion-b'])
    expect(opinions[0].stance).toBe('bearish')
  })

  it('filters opinions by symbol', async () => {
    await repository.saveOpinion(makeOpinion({ id: 'opinion-a', symbol: 'AAPL.US' }))
    await repository.saveOpinion(makeOpinion({ id: 'opinion-b', symbol: 'MSFT.US' }))
    const aapl = await repository.listOpinions('AAPL.US')
    expect(aapl.map((o) => o.id)).toEqual(['opinion-a'])
  })
})

describe('OutcomeRepository outcomes', () => {
  it('saves and reads an outcome by opinion id', async () => {
    const opinion = makeOpinion()
    const outcome = outcomeFor(opinion.id)
    await repository.saveOpinion(opinion)
    await repository.saveOutcome(outcome)
    expect(await repository.getOutcomeByOpinionId(opinion.id)).toEqual(outcome)
  })

  it('keeps one outcome per opinion (upsert)', async () => {
    const opinion = makeOpinion()
    await repository.saveOpinion(opinion)
    await repository.saveOutcome(outcomeFor(opinion.id, { returnPercent: 5 }))
    await repository.saveOutcome(outcomeFor(opinion.id, { returnPercent: 8 }))
    const outcomes = await repository.listOutcomes()
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0].returnPercent).toBe(8)
  })

  it('filters outcomes by the opinion symbol', async () => {
    const aapl = makeOpinion({ id: 'opinion-a', symbol: 'AAPL.US' })
    const msft = makeOpinion({ id: 'opinion-b', symbol: 'MSFT.US' })
    await repository.saveOpinion(aapl)
    await repository.saveOpinion(msft)
    await repository.saveOutcome(outcomeFor(aapl.id))
    await repository.saveOutcome(outcomeFor(msft.id))

    const msftOutcomes = await repository.listOutcomes('MSFT.US')
    expect(msftOutcomes.map((o) => o.opinionId)).toEqual(['opinion-b'])
  })

  it('drops orphan outcomes from symbol-filtered lists but keeps them unfiltered', async () => {
    await repository.saveOutcome(outcomeFor('opinion-ghost'))
    expect(await repository.listOutcomes('AAPL.US')).toEqual([])
    expect(await repository.listOutcomes()).toHaveLength(1)
  })
})

describe('OutcomeRepository due opinions', () => {
  it('treats a horizon strictly past as due (1w / 1m / 3m)', async () => {
    const due1w = makeOpinion({
      id: 'opinion-1w',
      horizon: '1w',
      createdAt: NOW_MS - HORIZON_MS['1w'] - 1000,
    })
    const due1m = makeOpinion({
      id: 'opinion-1m',
      horizon: '1m',
      createdAt: NOW_MS - HORIZON_MS['1m'] - 1000,
    })
    const due3m = makeOpinion({
      id: 'opinion-3m',
      horizon: '3m',
      createdAt: NOW_MS - HORIZON_MS['3m'] - 1000,
    })
    await repository.saveOpinion(due1w)
    await repository.saveOpinion(due1m)
    await repository.saveOpinion(due3m)

    const due = await repository.listDueOpinions(NOW_MS)
    expect(due.map((o) => o.id).sort()).toEqual(['opinion-1m', 'opinion-1w', 'opinion-3m'])
  })

  it('does not treat the exact horizon boundary as due', async () => {
    const atBoundary = makeOpinion({
      id: 'opinion-boundary',
      createdAt: NOW_MS - HORIZON_MS['1m'],
    })
    await repository.saveOpinion(atBoundary)
    expect(await repository.listDueOpinions(NOW_MS)).toEqual([])
  })

  it('skips opinions that are not due yet', async () => {
    const notDue = makeOpinion({ id: 'opinion-young', createdAt: NOW_MS - 1000 })
    await repository.saveOpinion(notDue)
    expect(await repository.listDueOpinions(NOW_MS)).toEqual([])
  })

  it('skips due opinions that already have an outcome', async () => {
    const evaluated = makeOpinion({
      id: 'opinion-done',
      createdAt: NOW_MS - HORIZON_MS['1m'] - 1000,
    })
    const unevaluated = makeOpinion({
      id: 'opinion-pending',
      createdAt: NOW_MS - HORIZON_MS['1m'] - 1000,
    })
    await repository.saveOpinion(evaluated)
    await repository.saveOpinion(unevaluated)
    await repository.saveOutcome(outcomeFor(evaluated.id))

    const due = await repository.listDueOpinions(NOW_MS)
    expect(due.map((o) => o.id)).toEqual(['opinion-pending'])
  })

  it('round-trips through a fresh repository instance (persistence)', async () => {
    await repository.saveOpinion(makeOpinion())
    await repository.saveOutcome(outcomeFor('opinion-1'))

    const reloaded = new OutcomeRepository(new JsonFileStore(dir))
    expect(await reloaded.getOpinion('opinion-1')).toBeDefined()
    expect(await reloaded.getOutcomeByOpinionId('opinion-1')).toBeDefined()
  })
})
