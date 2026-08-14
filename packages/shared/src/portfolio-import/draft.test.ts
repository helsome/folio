import { describe, expect, it } from 'bun:test'
import type { PortfolioImportRow } from '@finagent/core'
import {
  commonCurrency,
  createDraft,
  createDraftId,
  draftHasRecognizableSymbols,
  draftToPortfolioInput,
  draftWarnings,
  rowsToHoldings,
  validateDraft,
} from './draft.ts'
import { parsePaste } from './parsers.ts'

const FULL_ROW: PortfolioImportRow = {
  symbol: 'AAPL.US',
  name: 'Apple',
  quantity: 100,
  costPrice: 180.5,
  currency: 'USD',
  confidence: 1.0,
  issues: [],
}

describe('createDraft', () => {
  it('builds a draft with id, source, rows, and timestamp', () => {
    const before = Date.now()
    const draft = createDraft('paste', [FULL_ROW])
    expect(draft.id).toMatch(/^draft_/)
    expect(draft.source).toBe('paste')
    expect(draft.rows).toEqual([FULL_ROW])
    expect(draft.importedAt).toBeGreaterThanOrEqual(before)
    expect(draft.importedAt).toBeLessThanOrEqual(Date.now())
  })

  it('generates unique ids', () => {
    expect(createDraftId()).not.toBe(createDraftId())
  })

  it('summarizes low-confidence and issue rows as warnings', () => {
    const low = { ...FULL_ROW, confidence: 0.6, issues: ['Quantity missing'] }
    const draft = createDraft('csv', [FULL_ROW, low])
    expect(draft.warnings).toContain('1 row needs review')
    expect(draft.warnings.some((w) => w.includes('issues'))).toBe(true)
  })

  it('warns about duplicate and empty-symbol rows', () => {
    const dup = { ...FULL_ROW, issues: ['Duplicate symbol "AAPL.US"'] }
    const empty = { ...FULL_ROW, symbol: '', confidence: 0.3, issues: ['Missing symbol'] }
    const draft = createDraft('paste', [dup, empty])
    expect(draft.warnings.some((w) => w.includes('duplicate'))).toBe(true)
    expect(draft.warnings.some((w) => w.includes('no recognizable symbol'))).toBe(true)
  })

  it('has zero warnings for a clean draft', () => {
    expect(createDraft('paste', [FULL_ROW]).warnings).toEqual([])
  })
})

describe('validateDraft', () => {
  it('returns per-row issues prefixed with the symbol', () => {
    const rows = parsePaste('AAPL.US 100 180.5\nBROKEN 100 180.5')
    const issues = validateDraft(createDraft('paste', rows))
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain('BROKEN')
    expect(issues[0]).toContain('market suffix')
  })

  it('returns an empty list for a clean draft', () => {
    expect(validateDraft(createDraft('paste', [FULL_ROW]))).toEqual([])
  })
})

describe('draftHasRecognizableSymbols', () => {
  it('is true when every row has a symbol', () => {
    expect(draftHasRecognizableSymbols(createDraft('paste', [FULL_ROW]))).toBe(true)
  })

  it('is false when a row has no symbol', () => {
    const empty = { ...FULL_ROW, symbol: '' }
    expect(draftHasRecognizableSymbols(createDraft('paste', [empty]))).toBe(false)
  })

  it('is false for an empty draft', () => {
    expect(draftHasRecognizableSymbols(createDraft('paste', []))).toBe(false)
  })
})

describe('commonCurrency', () => {
  it('returns the shared currency', () => {
    const usd = { ...FULL_ROW, currency: 'USD' }
    const usd2 = { ...FULL_ROW, symbol: 'MSFT.US', currency: 'usd' }
    expect(commonCurrency([usd, usd2])).toBe('USD')
  })

  it('returns undefined when currencies disagree or are absent', () => {
    const usd = { ...FULL_ROW, currency: 'USD' }
    const hkd = { ...FULL_ROW, symbol: '0700.HK', currency: 'HKD' }
    const noCurrency = { ...FULL_ROW, symbol: 'MSFT.US' }
    delete noCurrency.currency
    expect(commonCurrency([usd, hkd])).toBeUndefined()
    expect(commonCurrency([noCurrency])).toBeUndefined()
    expect(commonCurrency([])).toBeUndefined()
  })
})

describe('rowsToHoldings', () => {
  it('maps confirmed rows to Holding shape', () => {
    const holdings = rowsToHoldings([
      FULL_ROW,
      { ...FULL_ROW, symbol: '0700.HK', name: 'Tencent', quantity: 500, costPrice: 320, currency: 'HKD' },
    ])
    expect(holdings).toEqual([
      { symbol: 'AAPL.US', name: 'Apple', currency: 'USD', quantity: 100, costPrice: 180.5 },
      { symbol: '0700.HK', name: 'Tencent', currency: 'HKD', quantity: 500, costPrice: 320 },
    ])
  })

  it('drops rows without a symbol and leaves optional numerics undefined', () => {
    const partial: PortfolioImportRow = { symbol: 'TSLA.US', confidence: 0.6, issues: ['Quantity missing'] }
    const empty: PortfolioImportRow = { symbol: '', confidence: 0.3, issues: ['Missing symbol'] }
    expect(rowsToHoldings([partial, empty])).toEqual([{ symbol: 'TSLA.US', name: '' }])
  })
})

describe('draftToPortfolioInput', () => {
  it('defaults the name and derives currency from rows', () => {
    const draft = createDraft('paste', [FULL_ROW])
    const input = draftToPortfolioInput(draft, '   ')
    expect(input).toEqual({
      name: 'Manual Portfolio',
      currency: 'USD',
      holdings: [{ symbol: 'AAPL.US', name: 'Apple', currency: 'USD', quantity: 100, costPrice: 180.5 }],
    })
  })

  it('keeps a user-supplied name', () => {
    const draft = createDraft('paste', [FULL_ROW])
    expect(draftToPortfolioInput(draft, 'My Portfolio').name).toBe('My Portfolio')
  })

  it('omits currency when rows disagree', () => {
    const draft = createDraft('paste', [
      { ...FULL_ROW, currency: 'USD' },
      { ...FULL_ROW, symbol: '0700.HK', currency: 'HKD' },
    ])
    expect('currency' in draftToPortfolioInput(draft, 'Mixed')).toBe(false)
  })
})

describe('draftWarnings', () => {
  it('is empty for fully-confident issue-free rows', () => {
    expect(draftWarnings([FULL_ROW])).toEqual([])
  })

  it('counts singular and plural correctly', () => {
    expect(draftWarnings([{ ...FULL_ROW, confidence: 0.6 }])).toContain('1 row needs review')
    expect(
      draftWarnings([
        { ...FULL_ROW, confidence: 0.6 },
        { ...FULL_ROW, symbol: '0700.HK', confidence: 0.3 },
      ])
    ).toContain('2 rows need review')
  })
})
