import { describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseCsv } from './parsers.ts'
import { createDraft, draftToPortfolioInput } from './draft.ts'
import { ManualPortfolioRepository } from './repository.ts'
import { JsonFileStore } from '../storage/json-file-store.ts'

describe('CSV leading empty records', () => {
  for (const prefix of ['   \n', ',,,\n', '\t\t\n', '\uFEFF  \r\n\r\n']) {
    it(`finds the reordered header after ${JSON.stringify(prefix)}`, () => {
      const rows = parseCsv(`${prefix}Cost,Symbol,Quantity\n180.5,AAPL.US,100`)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ symbol: 'AAPL.US', quantity: 100, costPrice: 180.5, confidence: 1, issues: [] })
    })
  }

  it('resolves explicit header mappings after empty records', () => {
    const [row] = parseCsv('  \nUnits,Ticker,Average\n100,AAPL.US,180.5', { symbol: 'Ticker', quantity: 'Units', cost: 'Average' })
    expect(row).toMatchObject({ symbol: 'AAPL.US', quantity: 100, costPrice: 180.5, issues: [] })
  })

  it('preserves headerless rows and returns no rows for blank-only input', () => {
    expect(parseCsv('  \nAAPL.US,Apple,100,180.5')[0]).toMatchObject({ symbol: 'AAPL.US', name: 'Apple', quantity: 100, costPrice: 180.5 })
    expect(parseCsv('  \n,,,\n\t\t\n')).toEqual([])
  })

  it('preserves newlines in quoted cells after leading empty records', () => {
    const rows = parseCsv(' \nSymbol,Name,Quantity,Cost\nAAPL.US,"Apple\nInc.",100,180.5')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ symbol: 'AAPL.US', name: 'Apple\nInc.', quantity: 100, costPrice: 180.5, issues: [] })
  })

  it('persists only the actual holding with the correct column mapping', async () => {
    const store = new JsonFileStore(mkdtempSync(join(tmpdir(), 'folio-leading-rows-')))
    const draft = createDraft('csv', parseCsv(' \nCost,Symbol,Quantity\n180.5,AAPL.US,100'))
    const created = await new ManualPortfolioRepository(store).create(draftToPortfolioInput(draft, 'Import'))
    const reloaded = await new ManualPortfolioRepository(store).get(created.id)
    expect(reloaded?.holdings).toEqual([{ symbol: 'AAPL.US', name: '', quantity: 100, costPrice: 180.5 }])
  })
})
