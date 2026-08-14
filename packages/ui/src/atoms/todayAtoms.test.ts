import { describe, expect, it } from 'bun:test'
import type { CalendarEvent, InvestmentThesis, Quote } from '@finagent/core'
import { mapUpcomingEvents, thesesNeedingReview, topMovers } from './todayAtoms'

function makeQuote(symbol: string, changePercent: number): Quote {
  return {
    symbol,
    lastPrice: 100,
    change: 1,
    changePercent,
    volume: 1000,
    timestamp: 1_700_000_000_000,
    high: 105,
    low: 95,
    open: 99,
    prevClose: 99,
  }
}

function makeThesis(id: string, updatedAt: number, lastReviewedAt: number): InvestmentThesis {
  return {
    id,
    symbol: 'NVDA.US',
    stance: 'bullish',
    summary: 'summary',
    bullCase: [],
    bearCase: [],
    catalysts: [],
    risks: [],
    evidenceRefs: [],
    createdAt: 0,
    updatedAt,
    lastReviewedAt,
  }
}

function makeEvent(id: string, date: number, symbol = 'NVDA.US', type = 'financial'): CalendarEvent {
  return { id, date, type, symbol }
}

describe('topMovers', () => {
  it('sorts by absolute change percent, biggest first', () => {
    const movers = topMovers([
      makeQuote('A.US', 1.5),
      makeQuote('B.US', -4.2),
      makeQuote('C.US', 2.1),
    ])
    expect(movers.map((m) => m.symbol)).toEqual(['B.US', 'C.US', 'A.US'])
    expect(movers[0].changePercent).toBe(-4.2)
  })

  it('drops non-finite change percents and respects the limit', () => {
    const movers = topMovers(
      [makeQuote('A.US', 1), makeQuote('B.US', 2), makeQuote('C.US', 3), makeQuote('D.US', 4), makeQuote('E.US', 5), makeQuote('F.US', 6)],
      3,
    )
    expect(movers).toHaveLength(3)
    expect(movers[0].symbol).toBe('F.US')
  })

  it('returns an empty list for empty input', () => {
    expect(topMovers([])).toEqual([])
  })
})

describe('thesesNeedingReview', () => {
  it('keeps theses updated after their last review', () => {
    const theses = [
      makeThesis('fresh', 200, 100),
      makeThesis('reviewed', 200, 200),
      makeThesis('never-reviewed', 200, 0),
    ]
    expect(thesesNeedingReview(theses).map((t) => t.id)).toEqual(['fresh', 'never-reviewed'])
  })

  it('returns an empty list when everything is reviewed', () => {
    expect(thesesNeedingReview([makeThesis('ok', 100, 100)])).toEqual([])
  })
})

describe('mapUpcomingEvents', () => {
  const now = 1_700_000_000

  it('keeps only future events, soonest first', () => {
    const events = [
      makeEvent('past', now - 10),
      makeEvent('later', now + 100),
      makeEvent('soon', now + 10),
    ]
    const mapped = mapUpcomingEvents(events, now)
    expect(mapped.map((e) => e.id)).toEqual(['soon', 'later'])
  })

  it('drops non-finite dates and applies the limit', () => {
    const events = [
      makeEvent('a', now + 1),
      makeEvent('b', now + 2),
      makeEvent('c', now + 3),
      makeEvent('nan', Number.NaN),
    ]
    const mapped = mapUpcomingEvents(events, now, 2)
    expect(mapped.map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('maps symbols, type, and local date onto display rows', () => {
    const event: CalendarEvent = {
      id: 'e1',
      date: now + 5,
      type: 'financial',
      symbol: 'NVDA.US',
      activityType: 'earnings',
      name: 'NVIDIA',
      content: 'Q2 earnings',
      localDate: '2026-08-20',
    }
    expect(mapUpcomingEvents([event], now)).toEqual([
      {
        id: 'e1',
        symbol: 'NVDA.US',
        type: 'financial',
        activityType: 'earnings',
        name: 'NVIDIA',
        content: 'Q2 earnings',
        date: now + 5,
        localDate: '2026-08-20',
      },
    ])
  })
})
