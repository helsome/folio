import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ManualPortfolio } from '@finagent/core'
import { JsonFileStore } from '../storage/json-file-store.ts'
import { createDraft } from './draft.ts'
import { parsePaste } from './parsers.ts'
import { ManualPortfolioRepository } from './repository.ts'

function tempStore(): JsonFileStore {
  return new JsonFileStore(mkdtempSync(join(tmpdir(), 'folio-manual-portfolios-')))
}

const INPUT = {
  name: 'My Portfolio',
  currency: 'USD',
  holdings: [
    { symbol: 'AAPL.US', name: 'Apple', currency: 'USD', quantity: 100, costPrice: 180.5 },
  ],
}

describe('ManualPortfolioRepository', () => {
  it('lists nothing before the first create', async () => {
    const repository = new ManualPortfolioRepository(tempStore())
    expect(await repository.list()).toEqual([])
  })

  it('round-trips create → list → get', async () => {
    const store = tempStore()
    const repository = new ManualPortfolioRepository(store)
    const created = await repository.create(INPUT)
    expect(created.id).toMatch(/^manual_/)
    expect(created).toMatchObject({ name: 'My Portfolio', currency: 'USD' })
    expect(created.holdings[0]).toMatchObject({ symbol: 'AAPL.US', quantity: 100, costPrice: 180.5 })
    expect(created.updatedAt).toBeGreaterThan(0)

    const listed = await repository.list()
    expect(listed).toHaveLength(1)
    expect(listed[0].id).toBe(created.id)

    const byId = await repository.get(created.id)
    expect(byId).toEqual(created)
    expect(await repository.get('nope')).toBeUndefined()
  })

  it('persists across repository instances (same store)', async () => {
    const store = tempStore()
    const first = new ManualPortfolioRepository(store)
    const created = await first.create(INPUT)

    const second = new ManualPortfolioRepository(store)
    const listed = await second.list()
    expect(listed).toHaveLength(1)
    expect(listed[0]).toEqual(created)
  })

  it('updates an existing portfolio and keeps its id', async () => {
    const repository = new ManualPortfolioRepository(tempStore())
    const created = await repository.create(INPUT)
    const updated = await repository.update(created.id, {
      name: 'Renamed',
      holdings: [...created.holdings, { symbol: '0700.HK', name: 'Tencent', quantity: 500, costPrice: 320 }],
    })
    expect(updated.id).toBe(created.id)
    expect(updated.name).toBe('Renamed')
    expect(updated.holdings).toHaveLength(2)
    const reloaded = await repository.get(created.id)
    expect(reloaded?.holdings).toHaveLength(2)
  })

  it('throws on updating an unknown portfolio', async () => {
    const repository = new ManualPortfolioRepository(tempStore())
    expect(repository.update('ghost', INPUT)).rejects.toThrow('not found')
  })

  it('deletes a portfolio and is a no-op for unknown ids', async () => {
    const repository = new ManualPortfolioRepository(tempStore())
    const created = await repository.create(INPUT)
    await repository.delete(created.id)
    expect(await repository.list()).toEqual([])

    const second = await repository.create(INPUT)
    await repository.delete('ghost')
    expect(await repository.list()).toHaveLength(1)
    expect((await repository.list())[0].id).toBe(second.id)
  })

  it('treats a corrupt file as empty and never throws', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'folio-manual-portfolios-'))
    writeFileSync(join(dir, 'manual-portfolios.json'), 'not json{')
    const repository = new ManualPortfolioRepository(new JsonFileStore(dir))
    expect(await repository.list()).toEqual([])
    const created = await repository.create(INPUT)
    expect(created.id).toBeTruthy()
  })

  it('omits currency in the file when the input has none', async () => {
    const store = tempStore()
    const repository = new ManualPortfolioRepository(store)
    await repository.create({ name: 'Plain', holdings: [] })
    const raw = JSON.parse(readFileSync(store.resolve('manual-portfolios.json'), 'utf8')) as {
      portfolios: ManualPortfolio[]
    }
    expect('currency' in raw.portfolios[0]).toBe(false)
  })
})

describe('confirm persists only after confirm (spec §93)', () => {
  it('draft creation has zero side effects on disk', async () => {
    const store = tempStore()
    const repository = new ManualPortfolioRepository(store)

    // Parse + draft: nothing may touch the store.
    const rows = parsePaste('AAPL.US 100 180.5\n0700.HK 500 320')
    createDraft('paste', rows)
    expect(await repository.list()).toEqual([])

    // Only an explicit create persists.
    const draft = createDraft('paste', rows)
    const holdings = draft.rows.map((row) => ({ symbol: row.symbol, name: row.name ?? '' }))
    await repository.create({ name: 'Confirmed', holdings })
    expect(await repository.list()).toHaveLength(1)
  })
})
