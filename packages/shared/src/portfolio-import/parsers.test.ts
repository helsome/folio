import { describe, expect, it } from 'bun:test'
import {
  checkSymbol,
  flagDuplicates,
  normalizeImportSymbol,
  parseCsv,
  parsePaste,
  parsePasteLine,
  splitCsvLine,
  splitCsvRows,
  toFiniteNumber,
} from './parsers.ts'

describe('normalizeSymbol', () => {
  it('uppercases and strips junk', () => {
    expect(normalizeImportSymbol(' aapl.us ')).toBe('AAPL.US')
    expect(normalizeImportSymbol('0700.hk')).toBe('0700.HK')
  })
})

describe('checkSymbol', () => {
  it('accepts canonical symbols with known markets', () => {
    for (const symbol of ['AAPL.US', '0700.HK', '600519.SH', '000001.SZ', 'D05.SG', 'BABA.HAS']) {
      expect(checkSymbol(symbol).ambiguous).toBe(false)
      expect(checkSymbol(symbol).issue).toBeUndefined()
    }
  })

  it('flags bare tickers as ambiguous with a market-suffix hint', () => {
    const check = checkSymbol('aapl')
    expect(check.ambiguous).toBe(true)
    expect(check.symbol).toBe('AAPL')
    expect(check.issue).toContain('AAPL.US')
  })

  it('flags garbage as ambiguous', () => {
    const check = checkSymbol('AAPL.BBB')
    expect(check.ambiguous).toBe(true)
    expect(check.issue).toContain('not a recognized ticker')
  })

  it('flags an empty symbol as missing', () => {
    expect(checkSymbol('').issue).toBe('Missing symbol')
  })

  it('rejects unknown market suffixes', () => {
    expect(checkSymbol('AAPL.XX').ambiguous).toBe(true)
  })
})

describe('toFiniteNumber', () => {
  it('coerces string numbers', () => {
    expect(toFiniteNumber('100')).toBe(100)
    expect(toFiniteNumber('180.50')).toBe(180.5)
    expect(toFiniteNumber('-45.2')).toBe(-45.2)
  })

  it('coerces real numbers and rejects non-finite', () => {
    expect(toFiniteNumber(100)).toBe(100)
    expect(toFiniteNumber(NaN)).toBeUndefined()
    expect(toFiniteNumber(Infinity)).toBeUndefined()
  })

  it('handles thousands separators and currency prefixes', () => {
    expect(toFiniteNumber('1,000')).toBe(1000)
    expect(toFiniteNumber('$180.50')).toBe(180.5)
    expect(toFiniteNumber(' 1,234.56 ')).toBe(1234.56)
  })

  it('returns undefined for null, empty, and junk', () => {
    expect(toFiniteNumber(null)).toBeUndefined()
    expect(toFiniteNumber(undefined)).toBeUndefined()
    expect(toFiniteNumber('')).toBeUndefined()
    expect(toFiniteNumber('   ')).toBeUndefined()
    expect(toFiniteNumber('abc')).toBeUndefined()
  })
})

describe('splitCsvRows', () => {
  it('handles CRLF and LF line endings', () => {
    expect(splitCsvRows('a,b\r\nc,d\r\n')).toEqual(['a,b', 'c,d'])
    expect(splitCsvRows('a,b\nc,d')).toEqual(['a,b', 'c,d'])
  })

  it('keeps quoted newlines inside one logical row', () => {
    expect(splitCsvRows('"a\nb",c\nd,e')).toEqual(['"a\nb",c', 'd,e'])
  })
})

describe('splitCsvLine', () => {
  it('splits commas and handles quoted cells', () => {
    expect(splitCsvLine('AAPL.US,Apple,100,180.5')).toEqual(['AAPL.US', 'Apple', '100', '180.5'])
    expect(splitCsvLine('"A, Inc.",AAPL.US')).toEqual(['A, Inc.', 'AAPL.US'])
    expect(splitCsvLine('"said ""hi""",x')).toEqual(['said "hi"', 'x'])
  })
})

describe('parseCsv', () => {
  it('detects English headers and maps columns', () => {
    const rows = parseCsv('Symbol,Name,Quantity,Cost\nAAPL.US,Apple,100,180.5\n0700.HK,Tencent,500,320')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      symbol: 'AAPL.US',
      name: 'Apple',
      quantity: 100,
      costPrice: 180.5,
      confidence: 1.0,
      issues: [],
    })
    expect(rows[1]).toMatchObject({ symbol: '0700.HK', name: 'Tencent', quantity: 500, costPrice: 320 })
  })

  it('detects 中文 headers', () => {
    const rows = parseCsv('代码,名称,数量,成本,货币\nAAPL.US,苹果,100,180.5,USD\n0700.HK,腾讯,500,320,HKD')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ symbol: 'AAPL.US', name: '苹果', quantity: 100, costPrice: 180.5, currency: 'USD' })
    expect(rows[1]).toMatchObject({ symbol: '0700.HK', currency: 'HKD' })
  })

  it('detects alias variants (qty / shares / price / code)', () => {
    const rows = parseCsv('Code,Shares,Price\nAAPL.US,100,180.5')
    expect(rows[0]).toMatchObject({ symbol: 'AAPL.US', quantity: 100, costPrice: 180.5 })
  })

  it('supports an explicit headerMapping override', () => {
    const rows = parseCsv('Ticker,Avg Cost,Units\nAAPL.US,180.5,100', { symbol: 'Ticker', cost: 'Avg Cost', quantity: 'Units' })
    expect(rows[0]).toMatchObject({ symbol: 'AAPL.US', quantity: 100, costPrice: 180.5 })
  })

  it('falls back to positional columns when there is no header', () => {
    const rows = parseCsv('AAPL.US,Apple,100,180.5')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ symbol: 'AAPL.US', name: 'Apple', quantity: 100, costPrice: 180.5 })
  })

  it('isolates malformed rows instead of throwing (spec §103)', () => {
    const rows = parseCsv('Symbol,Quantity,Cost\nAAPL.US,100,180.5\nBROKEN\n0700.HK,abc,320')
    expect(rows).toHaveLength(3)
    expect(rows[0].issues).toEqual([])
    expect(rows[1].symbol).toBe('BROKEN')
    expect(rows[1].confidence).toBe(0.3)
    expect(rows[1].issues.some((issue) => issue.includes('market suffix'))).toBe(true)
    expect(rows[2].quantity).toBeUndefined()
    expect(rows[2].issues).toContain('Invalid quantity "abc"')
    expect(rows[2].confidence).toBe(0.6)
  })

  it('treats blank rows as skipped, not malformed', () => {
    const rows = parseCsv('Symbol,Quantity,Cost\n\nAAPL.US,100,180.5\n\n')
    expect(rows).toHaveLength(1)
  })

  it('flags duplicate symbols (spec §103)', () => {
    const rows = parseCsv('Symbol,Quantity,Cost\nAAPL.US,100,180.5\naapl.us,50,190')
    expect(rows[0].issues).toEqual([])
    expect(rows[1].issues).toContain('Duplicate symbol "AAPL.US"')
  })

  it('returns an empty array for empty input', () => {
    expect(parseCsv('')).toEqual([])
    expect(parseCsv('\n\n')).toEqual([])
  })

  it('keeps a row when a required column is missing (review required)', () => {
    const rows = parseCsv('Symbol,Cost\nAAPL.US,180.5')
    expect(rows[0]).toMatchObject({ symbol: 'AAPL.US', costPrice: 180.5 })
    expect(rows[0].quantity).toBeUndefined()
    expect(rows[0].confidence).toBe(0.6)
    expect(rows[0].issues).toContain('Quantity missing')
  })
})

describe('confidence tiers (spec §48)', () => {
  it('1.0 when all required fields parse', () => {
    expect(parseCsv('Symbol,Quantity,Cost\nAAPL.US,100,180.5')[0].confidence).toBe(1.0)
  })

  it('0.6 when quantity or cost is missing', () => {
    expect(parseCsv('Symbol,Cost\nAAPL.US,180.5')[0].confidence).toBe(0.6)
    expect(parseCsv('Symbol,Quantity\nAAPL.US,100')[0].confidence).toBe(0.6)
    expect(parseCsv('Symbol\nAAPL.US')[0].confidence).toBe(0.6)
  })

  it('0.3 when the symbol is ambiguous, regardless of other fields', () => {
    expect(parseCsv('Symbol,Quantity,Cost\nAAPL,100,180.5')[0].confidence).toBe(0.3)
    expect(parsePasteLine('AAPL 100 180.5').confidence).toBe(0.3)
  })
})

describe('parsePaste (spec §46)', () => {
  it('parses SYMBOL QTY COST', () => {
    const rows = parsePaste('AAPL.US 100 180.5')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ symbol: 'AAPL.US', quantity: 100, costPrice: 180.5, confidence: 1.0 })
  })

  it('parses SYMBOL, QTY, COST', () => {
    const rows = parsePaste('AAPL.US, 100, 180.5')
    expect(rows[0]).toMatchObject({ symbol: 'AAPL.US', quantity: 100, costPrice: 180.5, confidence: 1.0 })
  })

  it('parses SYMBOL, QTY, COST without spaces', () => {
    const rows = parsePaste('0700.HK,500,320')
    expect(rows[0]).toMatchObject({ symbol: '0700.HK', quantity: 500, costPrice: 320 })
  })

  it('parses symbol cost (two tokens)', () => {
    const rows = parsePaste('AAPL.US 180.5')
    expect(rows[0]).toMatchObject({ symbol: 'AAPL.US', costPrice: 180.5 })
    expect(rows[0].quantity).toBeUndefined()
    expect(rows[0].confidence).toBe(0.6)
  })

  it('parses a bare symbol', () => {
    const rows = parsePaste('AAPL.US')
    expect(rows[0].symbol).toBe('AAPL.US')
    expect(rows[0].confidence).toBe(0.6)
  })

  it('reads an optional fourth token as currency', () => {
    const rows = parsePaste('AAPL.US 100 180.5 HKD')
    expect(rows[0]).toMatchObject({ symbol: 'AAPL.US', quantity: 100, costPrice: 180.5, currency: 'HKD' })
  })

  it('parses multiple lines with mixed formats and extra whitespace', () => {
    const rows = parsePaste('  AAPL.US   100   180.5  \n0700.HK, 500, 320\nTSLA.US 250')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ symbol: 'AAPL.US', quantity: 100, costPrice: 180.5 })
    expect(rows[1]).toMatchObject({ symbol: '0700.HK', quantity: 500, costPrice: 320 })
    expect(rows[2]).toMatchObject({ symbol: 'TSLA.US', costPrice: 250 })
    expect(rows[2].confidence).toBe(0.6)
  })

  it('isolates a malformed line while keeping valid ones (spec §103)', () => {
    const rows = parsePaste('AAPL.US 100 180.5\nnot a ticker line\n0700.HK 500 320')
    expect(rows).toHaveLength(3)
    expect(rows[0].issues).toEqual([])
    expect(rows[1].confidence).toBe(0.3)
    expect(rows[1].issues.length).toBeGreaterThan(0)
    expect(rows[2].issues).toEqual([])
  })

  it('returns an empty array for empty input', () => {
    expect(parsePaste('')).toEqual([])
    expect(parsePaste('\n  \n')).toEqual([])
  })

  it('flags duplicates across lines', () => {
    const rows = parsePaste('AAPL.US 100 180.5\nAAPL.US 50 190')
    expect(rows[1].issues).toContain('Duplicate symbol "AAPL.US"')
  })
})

describe('flagDuplicates', () => {
  it('passes through unique rows untouched', () => {
    const rows = parsePaste('AAPL.US 100 180.5\n0700.HK 500 320')
    const copy = [...rows]
    const flagged = flagDuplicates(copy)
    expect(flagged).toBe(copy)
    expect(flagged[0].issues).toEqual([])
    expect(flagged[1].issues).toEqual([])
  })
})
