import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ManualPortfolio } from '@finagent/core'
import { JsonFileStore } from '../storage/json-file-store.ts'
import { createDraft, draftHasRecognizableSymbols, draftToPortfolioInput, validateDraft } from './draft.ts'
import { parseCsv, parsePaste } from './parsers.ts'
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
  it('retains every simultaneous confirmed import across repository instances', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'folio-manual-portfolios-'))
    const repositories = [
      new ManualPortfolioRepository(new JsonFileStore(dir)),
      new ManualPortfolioRepository(new JsonFileStore(dir)),
    ]
    const created = await Promise.all(Array.from({ length: 20 }, (_, index) =>
      repositories[index % 2].create({ ...INPUT, name: `Portfolio ${index}` })
    ))
    const persisted = await new ManualPortfolioRepository(new JsonFileStore(dir)).list()
    expect(persisted).toHaveLength(20)
    expect(new Set(persisted.map((portfolio) => portfolio.id)).size).toBe(20)
    expect(new Set(created.map((portfolio) => portfolio.id))).toEqual(
      new Set(persisted.map((portfolio) => portfolio.id))
    )
  })

  it('retains simultaneous edits to different portfolios', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'folio-manual-portfolios-'))
    const first = new ManualPortfolioRepository(new JsonFileStore(dir))
    const second = new ManualPortfolioRepository(new JsonFileStore(dir))
    const a = await first.create({ ...INPUT, name: 'A' })
    const b = await first.create({ ...INPUT, name: 'B' })
    await Promise.all([
      first.update(a.id, { ...INPUT, name: 'A updated' }),
      second.update(b.id, { ...INPUT, name: 'B updated' }),
    ])
    const persisted = await first.list()
    expect(persisted.find((portfolio) => portfolio.id === a.id)?.name).toBe('A updated')
    expect(persisted.find((portfolio) => portfolio.id === b.id)?.name).toBe('B updated')
  })

  it('does not resurrect a deleted portfolio during a simultaneous edit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'folio-manual-portfolios-'))
    const first = new ManualPortfolioRepository(new JsonFileStore(dir))
    const second = new ManualPortfolioRepository(new JsonFileStore(dir))
    const a = await first.create({ ...INPUT, name: 'A' })
    const b = await first.create({ ...INPUT, name: 'B' })
    await Promise.all([
      first.delete(a.id),
      second.update(b.id, { ...INPUT, name: 'B updated' }),
    ])
    expect((await first.list()).map((portfolio) => [portfolio.id, portfolio.name])).toEqual([
      [b.id, 'B updated'],
    ])
  })

  it('continues processing a queued create after an update rejects', async () => {
    const store = tempStore()
    const first = new ManualPortfolioRepository(store)
    const second = new ManualPortfolioRepository(store)
    const failed = first.update('missing', INPUT).catch((error: unknown) => error)
    const created = second.create(INPUT)
    const error = await failed as Error
    expect(error.message).toContain('not found')
    expect((await created).name).toBe('My Portfolio')
    expect(await first.list()).toHaveLength(1)
  })

  it('continues processing a queued create after a file write fails', async () => {
    class FailOnceStore extends JsonFileStore {
      private failNextWrite = true
      override async write(file: string, data: unknown): Promise<void> {
        if (this.failNextWrite) {
          this.failNextWrite = false
          throw new Error('simulated write failure')
        }
        return super.write(file, data)
      }
    }
    const dir = mkdtempSync(join(tmpdir(), 'folio-manual-portfolios-'))
    const first = new ManualPortfolioRepository(new FailOnceStore(dir))
    const second = new ManualPortfolioRepository(new JsonFileStore(dir))
    const failed = first.create(INPUT).catch((error: unknown) => error)
    const created = second.create({ ...INPUT, name: 'After failure' })
    const error = await failed as Error
    expect(error.message).toBe('simulated write failure')
    expect((await created).name).toBe('After failure')
    expect((await second.list()).map((portfolio) => portfolio.name)).toEqual(['After failure'])
  })

  it('persists TSV quantities and costs without splitting thousands separators', async () => {
    const store = tempStore()
    const draft = createDraft('csv', parseCsv('Symbol\tQuantity\tCost\tCurrency\nAAPL.US\t1,000\t1,234.50\tUSD'))
    const created = await new ManualPortfolioRepository(store).create(draftToPortfolioInput(draft, 'TSV'))
    const reloaded = await new ManualPortfolioRepository(store).get(created.id)
    expect(reloaded?.holdings).toEqual([{ symbol: 'AAPL.US', name: '', quantity: 1000, costPrice: 1234.5, currency: 'USD' }])
  })

  it('keeps invalid numeric cells absent through draft review and persistence', async () => {
    const store = tempStore()
    const draft = createDraft('csv', parseCsv('Symbol,Quantity,Cost\nAAPL.US,100,$\nMSFT.US,",",180.5'))
    expect(draft.warnings).toContain('2 rows need review')
    expect(validateDraft(draft)).toEqual([
      'AAPL.US: Invalid cost price "$"',
      'MSFT.US: Invalid quantity ","',
    ])

    const repository = new ManualPortfolioRepository(store)
    const created = await repository.create(draftToPortfolioInput(draft, 'Review import'))
    const reloaded = await new ManualPortfolioRepository(store).get(created.id)
    expect(reloaded?.holdings).toEqual([
      { symbol: 'AAPL.US', name: '', quantity: 100 },
      { symbol: 'MSFT.US', name: '', costPrice: 180.5 },
    ])
  })

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

  for (const [description, contents] of [
    ['a null root', 'null'],
    ['an empty object', '{}'],
    ['a missing portfolios field', '{"other":[]}'],
    ['a null portfolios field', '{"portfolios":null}'],
    ['a non-array portfolios field', '{"portfolios":{}}'],
  ] as const) {
    it(`treats ${description} as empty and allows a new portfolio to be created`, async () => {
      const dir = mkdtempSync(join(tmpdir(), 'folio-manual-portfolios-'))
      writeFileSync(join(dir, 'manual-portfolios.json'), contents)
      const repository = new ManualPortfolioRepository(new JsonFileStore(dir))

      expect(await repository.list()).toEqual([])

      const created = await repository.create(INPUT)

      expect(await repository.list()).toEqual([created])
      const stored = JSON.parse(readFileSync(join(dir, 'manual-portfolios.json'), 'utf8')) as {
        portfolios: ManualPortfolio[]
      }
      expect(stored.portfolios).toEqual([created])
    })
  }

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
  it('preserves empty paste columns through review and persisted holdings', async () => {
    const store = tempStore()
    const repository = new ManualPortfolioRepository(store)
    const draft = createDraft('paste', parsePaste('AAPL.US,100,\nMSFT.US,,180.5,USD'))
    expect(draft.warnings).toContain('2 rows need review')
    expect(await repository.list()).toEqual([])
    const created = await repository.create(draftToPortfolioInput(draft, 'Partial holdings'))
    const reloaded = await new ManualPortfolioRepository(store).get(created.id)
    expect(reloaded?.holdings).toEqual([
      { symbol: 'AAPL.US', name: '', quantity: 100 },
      { symbol: 'MSFT.US', name: '', costPrice: 180.5, currency: 'USD' },
    ])
  })

  it('keeps a missing leading symbol blocked at draft confirmation', () => {
    const draft = createDraft('paste', parsePaste(',100,180.5,USD'))
    expect(draftHasRecognizableSymbols(draft)).toBe(false)
    expect(draft.warnings).toContain('1 row with no recognizable symbol')
  })

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
