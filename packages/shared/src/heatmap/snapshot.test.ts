import { describe, expect, it } from 'bun:test'
import type { CanonicalInstrument, HeatmapEntry, ProviderResult, Quote } from '@finagent/core'
import { buildHeatmapSnapshot } from './snapshot.ts'

const AAPL: CanonicalInstrument = {
  instrumentId: 'XNAS:AAPL', symbol: 'AAPL', name: 'Apple Inc.', market: 'US', country: 'US',
  assetType: 'equity', currency: 'USD', providerAliases: [],
}
const MSFT: CanonicalInstrument = {
  instrumentId: 'XNAS:MSFT', symbol: 'MSFT', name: 'Microsoft Corp.', market: 'US', country: 'US',
  assetType: 'equity', currency: 'USD', providerAliases: [],
}

function quote(instrument: CanonicalInstrument, changePercent: number, options: { stale?: boolean; instrumentId?: string } = {}): ProviderResult<Quote> {
  return {
    ok: true,
    data: {
      symbol: `${instrument.symbol}.US`, instrumentId: options.instrumentId ?? instrument.instrumentId,
      lastPrice: 100, change: changePercent, changePercent, volume: 1, timestamp: 1_700_000_000,
      high: 101, low: 99, open: 100, prevClose: 100,
    },
    provenance: {
      providerId: 'fixture', providerName: 'Fixture', instrumentId: instrument.instrumentId,
      fetchedAt: 1_700_000_001_000, stale: options.stale ?? false,
    },
  }
}

function entry(instrument: CanonicalInstrument, sector: string, value?: number, result?: ProviderResult<Quote>): HeatmapEntry {
  return {
    instrument, sector, quote: result,
    ...(value === undefined ? {} : { holding: { quantity: 1, currency: instrument.currency, marketValueBase: value } }),
  }
}

describe('buildHeatmapSnapshot', () => {
  it('deduplicates canonical instruments and gives watchlist entries equal area', () => {
    const snapshot = buildHeatmapSnapshot({
      snapshotId: 'watch-1', mode: 'watchlist', entries: [
        entry(AAPL, 'Technology', undefined, quote(AAPL, 2)),
        entry(AAPL, 'Technology', undefined, quote(AAPL, 3)),
        entry(MSFT, '', undefined, quote(MSFT, -1)),
      ],
    })

    expect(snapshot.weightsAvailable).toBe(true)
    expect(snapshot.groups).toHaveLength(2)
    expect(snapshot.groups.find((group) => group.sector === 'Technology')?.cells[0].areaWeight).toBe(0.5)
    expect(snapshot.groups.find((group) => group.sector === null)?.cells[0].areaWeight).toBe(0.5)
  })

  it('keeps unavailable and stale quote state explicit', () => {
    const snapshot = buildHeatmapSnapshot({
      snapshotId: 'watch-2', mode: 'watchlist', entries: [
        entry(AAPL, 'Technology'),
        entry(MSFT, 'Technology', undefined, quote(MSFT, 0, { stale: true })),
      ],
    })
    const cells = snapshot.groups[0].cells
    expect(cells[0]).toMatchObject({ changePercent: null, quoteStatus: 'missing' })
    expect(cells[1]).toMatchObject({ changePercent: 0, quoteStatus: 'stale' })
  })

  it('uses base-currency market values and aggregates duplicate portfolio lots', () => {
    const snapshot = buildHeatmapSnapshot({
      snapshotId: 'portfolio-1', mode: 'portfolio', baseCurrency: 'usd', entries: [
        entry(AAPL, 'Technology', 400, quote(AAPL, 2)),
        entry(AAPL, 'Technology', 300, quote(AAPL, 2)),
        entry(MSFT, 'Technology', 300, quote(MSFT, 1)),
      ],
    })
    const cells = snapshot.groups[0].cells
    expect(snapshot.weightsAvailable).toBe(true)
    expect(cells.map((cell) => cell.areaWeight)).toEqual([0.7, 0.3])
  })

  it('disables portfolio area weights when a lot is short or not comparable', () => {
    const snapshot = buildHeatmapSnapshot({
      snapshotId: 'portfolio-2', mode: 'portfolio', baseCurrency: 'USD', entries: [
        entry(AAPL, 'Technology', -100, quote(AAPL, 2)),
        entry(MSFT, 'Technology', 300, quote(MSFT, 1)),
      ],
    })
    expect(snapshot.weightsAvailable).toBe(false)
    expect(snapshot.weightIssues).toContain('unsupported-short')
    expect(snapshot.groups[0].cells.every((cell) => cell.areaWeight === null)).toBe(true)
  })

  it('rejects a quote bound to another canonical listing', () => {
    const snapshot = buildHeatmapSnapshot({
      snapshotId: 'watch-3', mode: 'watchlist', entries: [
        entry(AAPL, 'Technology', undefined, quote(AAPL, 5, { instrumentId: MSFT.instrumentId })),
      ],
    })
    expect(snapshot.groups[0].cells[0]).toMatchObject({ changePercent: null, quoteStatus: 'identity-mismatch' })
  })

  it('keeps the same ticker on different markets separate', () => {
    const other = { ...AAPL, instrumentId: 'XHKG:AAPL', market: 'HK', currency: 'HKD' }
    const result = buildHeatmapSnapshot({ snapshotId: 'cross-market', mode: 'watchlist', entries: [
      entry(AAPL, ''), entry(other, ''),
    ] })
    expect(result.groups[0].cells.map((cell) => cell.instrumentId)).toEqual(['XNAS:AAPL', 'XHKG:AAPL'])
    expect(result.groups[0].cells.map((cell) => cell.areaWeight)).toEqual([0.5, 0.5])
  })

  it('preserves actual provider, delay, market timestamp and fallback trail without aliasing the input', () => {
    const response = quote(AAPL, -2)
    if (!response.ok) throw new Error('Invalid fixture')
    response.provenance = {
      ...response.provenance, providerId: 'backup', providerName: 'Backup', delayed: true,
      marketTime: 1_699_999_000_000,
      failoverTrail: [{ providerId: 'primary', code: 'TIMEOUT', kind: 'transient', attempts: 1, at: 1 }],
    }
    const input = { snapshotId: 'delayed', mode: 'watchlist' as const, entries: [entry(AAPL, '', undefined, response)] }
    const before = JSON.stringify(input)
    const cell = buildHeatmapSnapshot(input).groups[0].cells[0]
    expect(cell).toMatchObject({
      changePercent: -2, quoteStatus: 'delayed', quoteTimestamp: 1_700_000_000,
      provenance: response.provenance,
    })
    cell.provenance!.failoverTrail![0].code = 'changed'
    expect(JSON.stringify(input)).toBe(before)
  })

  it('does not accept a provider ticker alone as canonical quote identity', () => {
    const response = quote(AAPL, 2)
    if (!response.ok) throw new Error('Invalid fixture')
    delete response.data.instrumentId
    delete response.provenance.instrumentId
    const cell = buildHeatmapSnapshot({ snapshotId: 'unbound', mode: 'watchlist', entries: [
      entry(AAPL, '', undefined, response),
    ] }).groups[0].cells[0]
    expect(cell).toMatchObject({ changePercent: null, quoteStatus: 'identity-unknown' })
    expect(cell.provenance).toBeUndefined()
    expect(cell.source).toBeUndefined()
  })

  it('derives MarketSource from provenance even when the input quote carries a different source', () => {
    for (const delayed of [true, false, undefined]) {
      const response = quote(AAPL, 0, { stale: true })
      if (!response.ok) throw new Error('Invalid fixture')
      response.provenance.delayed = delayed
      response.data.source = { providerId: 'wrong', providerName: 'Wrong', delayed: true }
      const cell = buildHeatmapSnapshot({ snapshotId: 'source', mode: 'watchlist', entries: [
        entry(AAPL, '', undefined, response),
      ] }).groups[0].cells[0]
      expect(cell.source).toEqual({
        providerId: 'fixture', providerName: 'Fixture', ...(delayed === true ? { delayed: true } : {}),
      })
      expect(cell.quoteStatus).toBe('stale')
      expect(cell.changePercent).toBe(0)
      cell.source!.providerName = 'changed'
      expect(response.provenance.providerName).toBe('Fixture')
      expect(response.data.source.providerName).toBe('Wrong')
    }
  })

  it('accepts provenance-bound identity when the quote has no instrumentId', () => {
    const response = quote(AAPL, 2)
    if (!response.ok) throw new Error('Invalid fixture')
    delete response.data.instrumentId
    expect(buildHeatmapSnapshot({ snapshotId: 'bound', mode: 'watchlist', entries: [
      entry(AAPL, '', undefined, response),
    ] }).groups[0].cells[0]).toMatchObject({ changePercent: 2, quoteStatus: 'available' })
  })

  it('keeps provider failures and non-finite changes distinct from a flat quote', () => {
    const response: ProviderResult<Quote> = { ok: false, error: { code: 'AUTH_EXPIRED', message: 'Sign in again' } }
    const cells = buildHeatmapSnapshot({ snapshotId: 'failed', mode: 'watchlist', entries: [
      entry(AAPL, '', undefined, response),
      entry(MSFT, '', undefined, quote(MSFT, Number.NaN)),
    ] }).groups[0].cells
    expect(cells[0]).toMatchObject({ changePercent: null, quoteStatus: 'error', errorCode: 'AUTH_EXPIRED' })
    expect(cells[1]).toMatchObject({ changePercent: null, quoteStatus: 'missing' })
  })

  it('uses reported base values for cross-currency holdings, never raw native amounts', () => {
    const hk = { ...MSFT, currency: 'HKD', market: 'HK' }
    const result = buildHeatmapSnapshot({ snapshotId: 'fx', mode: 'portfolio', baseCurrency: ' usd ', entries: [
      { ...entry(AAPL, '', 100), holding: { quantity: 1, currency: 'usd', marketValue: 100 } },
      { ...entry(hk, '', 100), holding: { quantity: 1, currency: 'HKD', marketValue: 780, marketValueBase: 100 } },
    ] })
    expect(result.baseCurrency).toBe('USD')
    expect(result.groups[0].cells.map((cell) => cell.areaWeight)).toEqual([0.5, 0.5])

    const unavailable = buildHeatmapSnapshot({ snapshotId: 'missing-fx', mode: 'portfolio', baseCurrency: 'USD', entries: [
      entry(AAPL, '', 100),
      { ...entry(hk, ''), holding: { quantity: 1, currency: 'HKD', marketValue: 780 } },
    ] })
    expect(unavailable.weightIssues).toContain('missing-valuation')
    expect(unavailable.groups[0].cells.map((cell) => cell.areaWeight)).toEqual([null, null])
  })

  it('does not infer base currency even when reported base values exist', () => {
    const result = buildHeatmapSnapshot({ snapshotId: 'no-base', mode: 'portfolio', entries: [entry(AAPL, '', 100)] })
    expect(result.weightsAvailable).toBe(false)
    expect(result.weightIssues).toContain('missing-base-currency')
  })

  it('rejects a short lot even when duplicate lots have positive net value', () => {
    const result = buildHeatmapSnapshot({ snapshotId: 'net', mode: 'portfolio', baseCurrency: 'USD', entries: [
      entry(AAPL, '', 300), { ...entry(AAPL, '', 100), holding: { quantity: -1, marketValueBase: -100 } },
    ] })
    expect(result.weightsAvailable).toBe(false)
    expect(result.groups[0].cells[0].weightIssues).toContain('unsupported-short')
    expect(result.groups[0].cells[0].areaWeight).toBeNull()
  })

  it('rejects missing/non-finite valuation, zero total and overflow', () => {
    for (const holdings of [
      [{ quantity: undefined, marketValueBase: 100 }],
      [{ quantity: 1, marketValueBase: undefined }],
      [{ quantity: 1, marketValueBase: Number.NaN }],
      [{ quantity: 1, marketValueBase: 0 }],
      [{ quantity: 1, marketValueBase: Number.MAX_VALUE }, { quantity: 1, marketValueBase: Number.MAX_VALUE }],
    ]) {
      const result = buildHeatmapSnapshot({ snapshotId: 'invalid', mode: 'portfolio', baseCurrency: 'USD',
        entries: holdings.map((holding) => ({ ...entry(AAPL, ''), holding })),
      })
      expect(result.weightsAvailable).toBe(false)
      expect(result.groups[0].cells[0].areaWeight).toBeNull()
    }
  })

  it('rejects short quantity even when a provider reports a positive market value', () => {
    const result = buildHeatmapSnapshot({ snapshotId: 'short', mode: 'portfolio', baseCurrency: 'USD', entries: [
      { ...entry(AAPL, ''), holding: { quantity: -1, marketValueBase: 100 } },
    ] })
    expect(result.weightsAvailable).toBe(false)
    expect(result.weightIssues).toContain('unsupported-short')
  })

  it('returns a real empty snapshot without demo entries', () => {
    for (const mode of ['watchlist', 'portfolio'] as const) {
      expect(buildHeatmapSnapshot({ snapshotId: 'empty', mode, entries: [] })).toMatchObject({
        snapshotId: 'empty', groups: [], weightsAvailable: false,
      })
    }
  })

  it('requires snapshot and canonical instrument identity', () => {
    expect(() => buildHeatmapSnapshot({ snapshotId: ' ', mode: 'watchlist', entries: [] })).toThrow('snapshotId')
    expect(() => buildHeatmapSnapshot({ snapshotId: 'watch', mode: 'watchlist', entries: [
      entry({ ...AAPL, instrumentId: '' }, ''),
    ] })).toThrow('canonical instrumentId')
  })

  it('projects 100 instruments deterministically and preserves selection keys across quote refresh', () => {
    const entries = Array.from({ length: 100 }, (_, i) => {
      const instrument = { ...AAPL, instrumentId: `XNAS:TEST${i}`, symbol: `TEST${i}` }
      return entry(instrument, `Sector ${i % 10}`, undefined, quote(instrument, i % 5 - 2))
    })
    const input = { snapshotId: 'version-1', mode: 'watchlist' as const, entries }
    const before = JSON.stringify(input)
    const first = buildHeatmapSnapshot(input)
    expect(first).toEqual(buildHeatmapSnapshot(input))
    expect(JSON.stringify(input)).toBe(before)
    const all = first.groups.flatMap((group) => group.cells)
    expect(all).toHaveLength(100)
    expect(all.reduce((sum, cell) => sum + cell.areaWeight!, 0)).toBeCloseTo(1)
    const refreshed = buildHeatmapSnapshot({ ...input, snapshotId: 'version-2', entries: entries.map((item) => ({
      ...item, quote: quote(item.instrument, 1),
    })) })
    expect(refreshed.groups.flatMap((group) => group.cells.map((cell) => cell.instrumentId)))
      .toEqual(all.map((cell) => cell.instrumentId))
  })
})
