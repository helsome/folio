import { describe, expect, it } from 'bun:test'
import type {
  CalendarEvent,
  FinancialReport,
  Kline,
  Quote,
  ScreeningStrategy,
} from '@finagent/core'
import {
  BREAKOUT_VOLUME_MULT,
  DIVIDEND_YIELD_PCT,
  extractFinancialMetrics,
  getScreeningStrategy,
  SCREENING_STRATEGIES,
  type SymbolData,
} from './strategies.ts'

const NOW_SECONDS = 1_700_000_000

function makeContext(overrides: Partial<SymbolData> & { symbol?: string }) {
  const { symbol = 'AAPL.US', ...data } = overrides
  return {
    symbol,
    data: { symbol, evidence: ['run-quote-1', 'run-kline-2'], ...data },
    market: 'US',
    nowSeconds: NOW_SECONDS,
  }
}

function quote(changePercent: number, lastPrice = 100): Quote {
  return {
    symbol: 'AAPL.US',
    lastPrice,
    change: (lastPrice * changePercent) / 100,
    changePercent,
    volume: 1_000_000,
    timestamp: NOW_SECONDS,
    high: lastPrice * 1.01,
    low: lastPrice * 0.99,
    open: lastPrice,
    prevClose: lastPrice,
  }
}

function bars(count: number, startClose = 100, step = 1, volume = 1_000_000): Kline[] {
  return Array.from({ length: count }, (_, i) => {
    const close = startClose + i * step
    return {
      symbol: 'AAPL.US',
      timestamp: NOW_SECONDS - (count - i) * 86_400,
      open: close,
      high: close * 1.01,
      low: close * 0.99,
      close,
      volume,
    }
  })
}

/** Financial report with the exact field codes the Longbridge CLI emits. */
function financialReport(accounts: Record<string, { value?: number; yoy?: string }>): FinancialReport {
  return {
    symbol: 'AAPL.US',
    report: 'qf',
    statements: {
      IS: {
        indicators: [
          {
            title: 'Profitability',
            accounts: Object.entries(accounts).map(([field, entry]) => ({
              field,
              name: field,
              values: [
                {
                  fpEnd: NOW_SECONDS - 86_400,
                  period: 'Q1 2027',
                  year: 2027,
                  value: entry.value ?? 0,
                  ...(entry.yoy !== undefined ? { yoy: entry.yoy } : {}),
                },
              ],
            })),
          },
        ],
      },
    },
  }
}

function calendarEvent(symbol: string, daysFromNow: number): CalendarEvent {
  return {
    id: `evt-${symbol}-${daysFromNow}`,
    date: NOW_SECONDS + daysFromNow * 86_400,
    type: 'financial',
    symbol,
    name: `${symbol} earnings`,
  }
}

describe('SCREENING_STRATEGIES', () => {
  it('implements all 17 tasks exactly once with families', () => {
    const ids = SCREENING_STRATEGIES.map((strategy) => strategy.id)
    expect(ids).toHaveLength(17)
    expect(new Set(ids).size).toBe(17)
    expect(new Set(SCREENING_STRATEGIES.map((strategy) => strategy.family))).toEqual(
      new Set(['market-movers', 'fundamental', 'technical', 'events'])
    )
    // Families cover every task.
    expect(SCREENING_STRATEGIES.filter((s) => s.family === 'market-movers')).toHaveLength(4)
    expect(SCREENING_STRATEGIES.filter((s) => s.family === 'fundamental')).toHaveLength(5)
    expect(SCREENING_STRATEGIES.filter((s) => s.family === 'technical')).toHaveLength(4)
    expect(SCREENING_STRATEGIES.filter((s) => s.family === 'events')).toHaveLength(4)
  })

  it('every capability id referenced by a strategy is a real registry id', () => {
    const realIds = new Set([
      'market.quote',
      'market.kline',
      'market.intraday',
      'market.sentiment',
      'company.profile',
      'company.valuation',
      'company.financials',
      'company.ratings',
      'company.dividends',
      'company.earnings',
      'research.news',
      'research.events',
    ])
    for (const strategy of SCREENING_STRATEGIES) {
      for (const id of strategy.capabilityIds) {
        expect(realIds.has(id), `${strategy.id} references unknown capability ${id}`).toBe(true)
      }
    }
  })

  it('every strategy produces a title, description, and compute', () => {
    for (const strategy of SCREENING_STRATEGIES) {
      expect(strategy.title.length).toBeGreaterThan(0)
      expect(strategy.description.length).toBeGreaterThan(0)
      expect(typeof strategy.compute).toBe('function')
    }
  })
})

describe('market-movers rules', () => {
  it('top-gainers ranks day gainers with a deterministic score', () => {
    const rule = getScreeningStrategy('top-gainers')!
    const small = rule.compute(makeContext({ quote: quote(2.5) }))
    const big = rule.compute(makeContext({ quote: quote(8.0) }))
    expect(small?.symbol).toBe('AAPL.US')
    expect(small?.score).toBeCloseTo(0.25, 6)
    expect(big?.score).toBeCloseTo(0.8, 6)
    expect(big!.score!).toBeGreaterThan(small!.score!)
    expect(big?.reasons[0]).toContain('+8.0%')
    expect(big?.evidence).toContain('run-quote-1')
    expect(big?.name).toBe('')
  })

  it('top-gainers skips flat/negative days', () => {
    const rule = getScreeningStrategy('top-gainers')!
    expect(rule.compute(makeContext({ quote: quote(0.5) }))).toBeNull()
    expect(rule.compute(makeContext({ quote: quote(-3) }))).toBeNull()
  })

  it('top-gainers skips when quote data is missing', () => {
    const rule = getScreeningStrategy('top-gainers')!
    expect(rule.compute(makeContext({}))).toBeNull()
  })

  it('top-losers surfaces the deepest decline first', () => {
    const rule = getScreeningStrategy('top-losers')!
    const mild = rule.compute(makeContext({ quote: quote(-2.0) }))
    const steep = rule.compute(makeContext({ quote: quote(-9.0) }))
    expect(mild?.score).toBeCloseTo(0.2, 6)
    expect(steep?.score).toBeCloseTo(0.9, 6)
    expect(steep!.score!).toBeGreaterThan(mild!.score!)
    expect(steep?.reasons[0]).toContain('-9.0%')
  })

  it('high-volume uses CalcIndex.volumeRatio against the baseline', () => {
    const rule = getScreeningStrategy('high-volume')!
    const result = rule.compute(makeContext({ valuation: { symbol: 'AAPL.US', volumeRatio: 2.4 } }))
    expect(result?.score).toBeCloseTo(0.7, 6)
    expect(result?.reasons[0]).toContain('2.40x')
    expect(rule.compute(makeContext({ valuation: { symbol: 'AAPL.US', volumeRatio: 1.1 } }))).toBeNull()
  })

  it('high-volume falls back to kline-derived volume ratio', () => {
    const rule = getScreeningStrategy('high-volume')!
    const klines = bars(30, 100, 1, 100_000)
    klines[klines.length - 1] = { ...klines[klines.length - 1], volume: 400_000 }
    const result = rule.compute(makeContext({ kline: klines, valuation: { symbol: 'AAPL.US' } }))
    expect(result).not.toBeNull()
    expect(result?.reasons[0]).toContain('20d average')
    // No baseline at all → skip, not fabricate.
    expect(rule.compute(makeContext({ kline: bars(3), valuation: { symbol: 'AAPL.US' } }))).toBeNull()
  })

  it('unusual-movement flags amplitude far above the 20d average', () => {
    const rule = getScreeningStrategy('unusual-movement')!
    const klines = bars(30, 100, 0, 1_000_000) // flat: amplitude ~2% per bar
    const wild = { ...klines[klines.length - 1], high: 112, low: 90 } // ~22% amplitude
    klines[klines.length - 1] = wild
    const result = rule.compute(
      makeContext({
        kline: klines,
        sentiment: { market: 'US', temperature: 72, description: 'Bullish', valuation: 60, sentiment: 70 },
      })
    )
    expect(result).not.toBeNull()
    expect(result?.reasons.some((reason) => reason.startsWith('Amplitude'))).toBe(true)
    expect(result?.reasons.some((reason) => reason.includes('Market temp 72/100'))).toBe(true)
    expect(rule.compute(makeContext({ kline: bars(30, 100, 0), valuation: { symbol: 'AAPL.US', amplitude: 2.2 } }))).toBeNull()
  })
})

describe('fundamental rules', () => {
  it('low-valuation scores PE and PB independently', () => {
    const rule = getScreeningStrategy('low-valuation')!
    const cheap = rule.compute(makeContext({ valuation: { symbol: 'AAPL.US', pe: 9.4, pb: 0.8 } }))
    expect(cheap?.reasons).toContain('PE 9.4')
    expect(cheap?.reasons).toContain('PB 0.80')
    expect(cheap!.score).toBeGreaterThan(0)
    expect(rule.compute(makeContext({ valuation: { symbol: 'AAPL.US', pe: 34, pb: 6 } }))).toBeNull()
    expect(rule.compute(makeContext({}))).toBeNull()
  })

  it('high-roe reads ROE from statement accounts (field code ROE)', () => {
    const rule = getScreeningStrategy('high-roe')!
    const result = rule.compute(
      makeContext({ financials: financialReport({ ROE: { value: 28.4 }, NetProfit: { value: 100 } }) })
    )
    expect(result?.reasons[0]).toBe('ROE 28.4%')
    expect(result?.metrics.roe).toBe(28.4)
    expect(rule.compute(makeContext({ financials: financialReport({ ROE: { value: 8 } }) }))).toBeNull()
  })

  it('revenue-growth reads YoY from the OperatingRevenue account', () => {
    const rule = getScreeningStrategy('revenue-growth')!
    const result = rule.compute(
      makeContext({ financials: financialReport({ OperatingRevenue: { value: 100, yoy: '35.5' } }) })
    )
    expect(result?.reasons[0]).toContain('+35.5%')
    expect(result?.score).toBeCloseTo(0.8875, 4)
  })

  it('extractFinancialMetrics prefers the normalized contract when present', () => {
    const metrics = extractFinancialMetrics(
      makeContext({
        normalizedFinancials: { roe: 22, revenueGrowth: 12, grossMargin: 55, netMargin: 20 },
        financials: financialReport({ ROE: { value: 5 } }),
      }).data
    )
    expect(metrics.roe).toBe(22)
    expect(metrics.revenueGrowth).toBe(12)
  })

  it('high-dividend requires yield above the bar and cites payment history', () => {
    const rule = getScreeningStrategy('high-dividend')!
    const result = rule.compute(
      makeContext({
        valuation: { symbol: 'AAPL.US', dpsRate: DIVIDEND_YIELD_PCT + 0.5 },
        dividends: [{ id: 'd1', description: 'dividend', exDate: NOW_SECONDS + 10 * 86_400 }],
      })
    )
    expect(result?.reasons[0]).toContain('3.50%')
    expect(result?.reasons).toContain('1 payments on record')
    expect(rule.compute(makeContext({ valuation: { symbol: 'AAPL.US', dpsRate: 1.2 } }))).toBeNull()
  })

  it('quality-growth needs ROE + margin + growth together', () => {
    const rule = getScreeningStrategy('quality-growth')!
    const strong = rule.compute(
      makeContext({
        normalizedFinancials: { roe: 30, revenueGrowth: 25, netMargin: 18 },
      })
    )
    expect(strong?.reasons).toHaveLength(3)
    expect(strong!.score).toBeGreaterThan(0)
    const noMargin = rule.compute(makeContext({ normalizedFinancials: { roe: 30, revenueGrowth: 25 } }))
    expect(noMargin).toBeNull()
  })
})

describe('technical rules', () => {
  it('strong-momentum needs 1m and 3m returns above the bar', () => {
    const rule = getScreeningStrategy('strong-momentum')!
    const result = rule.compute(makeContext({ kline: bars(90, 100, 1.2) }))
    expect(result?.reasons).toHaveLength(2)
    expect(result!.score).toBeGreaterThan(0)
    // Flat market → no momentum.
    expect(rule.compute(makeContext({ kline: bars(90, 100, 0) }))).toBeNull()
    // Too little history → honest skip.
    expect(rule.compute(makeContext({ kline: bars(10, 100, 5) }))).toBeNull()
  })

  it('breakout needs a new high on expanding volume', () => {
    const rule = getScreeningStrategy('breakout')!
    const klines = bars(30, 100, 0.4, 100_000)
    const avgVolume = 100_000
    klines[klines.length - 1] = {
      ...klines[klines.length - 1],
      close: 115,
      high: 116,
      volume: avgVolume * (BREAKOUT_VOLUME_MULT + 0.4),
    }
    const result = rule.compute(makeContext({ kline: klines }))
    expect(result?.reasons.some((reason) => reason.includes('above 20d high'))).toBe(true)
    expect(result?.reasons.some((reason) => reason.includes('1.90x average'))).toBe(true)
    // High but no volume expansion → no breakout.
    const quiet = bars(30, 100, 0.4, 100_000)
    quiet[quiet.length - 1] = { ...quiet[quiet.length - 1], close: 115, high: 116, volume: avgVolume }
    expect(rule.compute(makeContext({ kline: quiet }))).toBeNull()
  })

  it('oversold requires close well below its 20d average and a 3m decline', () => {
    const rule = getScreeningStrategy('oversold')!
    const falling = bars(90, 200, -1.4)
    const result = rule.compute(makeContext({ kline: falling }))
    expect(result?.reasons.some((reason) => reason.includes('below 20d average'))).toBe(true)
    expect(rule.compute(makeContext({ kline: bars(90, 100, 1) }))).toBeNull()
  })

  it('trend-reversal is a binary pattern with no score', () => {
    const rule = getScreeningStrategy('trend-reversal')!
    // 63 bars of decline, then 5 bars of recovery.
    const falling = bars(70, 200, -1)
    const recovering = falling.slice(0, 65).concat(bars(5, 130, 2))
    const result = rule.compute(makeContext({ kline: recovering }))
    expect(result).not.toBeNull()
    expect(result?.score).toBeUndefined()
    expect(result?.reasons[0]).toContain('3m decline')
    expect(rule.compute(makeContext({ kline: bars(90, 100, 1) }))).toBeNull()
  })
})

describe('events rules', () => {
  it('upcoming-earnings surfaces the nearest financial event in the window', () => {
    const rule = getScreeningStrategy('upcoming-earnings')!
    const result = rule.compute(
      makeContext({
        calendar: [calendarEvent('AAPL.US', 5), calendarEvent('AAPL.US', 45)],
      })
    )
    expect(result?.reasons[0]).toContain('Earnings in 5d')
    expect(result?.metrics.daysUntil).toBe(5)
    expect(rule.compute(makeContext({ calendar: [calendarEvent('AAPL.US', 45)] }))).toBeNull()
    expect(rule.compute(makeContext({}))).toBeNull()
  })

  it('rating-changes requires buy consensus plus target upside', () => {
    const rule = getScreeningStrategy('rating-changes')!
    const result = rule.compute(
      makeContext({
        ratings: { symbol: 'AAPL.US', recommend: 'strong_buy', target: 120, institutional: { distribution: { buy: 1, hold: 0, sell: 0, total: 1 }, change: 3 } },
        quote: quote(0, 100),
      })
    )
    expect(result?.reasons).toContain('Consensus strong buy')
    expect(result?.reasons).toContain('3 institutions changed rating')
    expect(result?.reasons.some((reason) => reason.includes('+20.0%'))).toBe(true)
    // Hold consensus → skip.
    expect(
      rule.compute(makeContext({ ratings: { symbol: 'AAPL.US', recommend: 'hold', target: 120 }, quote: quote(0, 100) }))
    ).toBeNull()
  })

  it('news-surge counts recent headlines', () => {
    const rule = getScreeningStrategy('news-surge')!
    const items = Array.from({ length: 6 }, (_, i) => ({
      id: `n${i}`,
      title: `headline ${i}`,
      summary: '',
      url: '',
      timestamp: NOW_SECONDS - i * 86_400,
      symbols: ['AAPL.US'],
    }))
    const result = rule.compute(makeContext({ news: items }))
    expect(result?.reasons[0]).toContain('6 headlines in 7d')
    expect(rule.compute(makeContext({ news: items.slice(0, 2) }))).toBeNull()
  })

  it('dividend-events surfaces ex-dates inside the window', () => {
    const rule = getScreeningStrategy('dividend-events')!
    const result = rule.compute(
      makeContext({
        dividends: [
          { id: 'd1', description: 'div', exDate: NOW_SECONDS + 3 * 86_400 },
          { id: 'd2', description: 'div', exDate: NOW_SECONDS + 300 * 86_400 },
        ],
      })
    )
    expect(result?.reasons[0]).toContain('Ex-dividend in 3d')
    expect(rule.compute(makeContext({ dividends: [{ id: 'd1', description: 'div', exDate: NOW_SECONDS + 300 * 86_400 }] }))).toBeNull()
  })
})

describe('strategy registry lookups', () => {
  it('getScreeningStrategy resolves every task id', () => {
    const ids: ScreeningStrategy[] = [
      'top-gainers',
      'top-losers',
      'high-volume',
      'unusual-movement',
      'low-valuation',
      'high-roe',
      'revenue-growth',
      'high-dividend',
      'quality-growth',
      'strong-momentum',
      'breakout',
      'oversold',
      'trend-reversal',
      'upcoming-earnings',
      'rating-changes',
      'news-surge',
      'dividend-events',
    ]
    for (const id of ids) {
      expect(getScreeningStrategy(id)?.id, id).toBe(id)
    }
    expect(getScreeningStrategy('nope' as ScreeningStrategy)).toBeUndefined()
  })
})
