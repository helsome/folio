import { describe, expect, it } from 'bun:test'
import type { AlertTriggerEvent, AutomationRun, ResearchDiff } from '@finagent/core'
import {
  buildBrief,
  type BriefInputs,
  type BriefWatchlistMover,
} from './brief.ts'

type ThesisDirection = 'unchanged' | 'strengthened' | 'weakened' | 'invalidated'

function run(id: string, materialChanges: number, notified: boolean, evaluated = 5): AutomationRun {
  return {
    id,
    ruleId: 'rule-1',
    ranAt: 1_700_000_000_000,
    evaluated,
    materialChanges,
    analyzed: materialChanges,
    notified,
    failures: [],
  }
}

function alert(id: string, symbol: string, title: string): AlertTriggerEvent {
  return {
    id,
    ruleId: 'alert-rule',
    ruleType: 'price_above',
    symbol,
    triggeredAt: 1_700_000_000_000,
    title,
    message: `${symbol} crossed the threshold`,
    payload: { threshold: 100 },
  }
}

function diff(
  symbol: string,
  material: boolean,
  thesisDirection?: ThesisDirection
): ResearchDiff {
  return {
    id: `diff-${symbol}`,
    symbol,
    previousReportId: 'prev',
    currentReportId: 'cur',
    generatedAt: 1_700_000_000_000,
    changes: [],
    material,
    summary: material ? 'material change' : 'no change',
    ...(thesisDirection !== undefined
      ? { thesisImpact: { direction: thesisDirection, summary: `${symbol} thesis moved` } }
      : {}),
  }
}

function inputs(overrides: Partial<BriefInputs> = {}): BriefInputs {
  return {
    runs: [],
    alerts: [],
    diffs: [],
    portfolio: [],
    movers: [],
    ...overrides,
  }
}

function mover(symbol: string, changePercent: number): BriefWatchlistMover {
  return { symbol, changePercent, lastPrice: 100 }
}

describe('buildBrief', () => {
  it('builds an empty quiet brief from empty inputs', () => {
    const brief = buildBrief(inputs(), 1_700_000_000_000)
    expect(brief.generatedAt).toBe(1_700_000_000_000)
    expect(brief.items).toEqual([])
    expect(brief.summary).toBe('Nothing needs your attention.')
    expect(brief.quiet).toEqual({ count: 0, message: 'No monitored securities.' })
  })

  it('every item carries an explainable source', () => {
    const brief = buildBrief(
      inputs({
        runs: [run('r1', 2, true)],
        alerts: [alert('a1', 'AAPL.US', 'AAPL price alert')],
        diffs: [diff('NVDA.US', true, 'strengthened')],
        portfolio: [{ label: 'AAPL.US · 12.4% of portfolio', detail: 'Single-stock exposure 12.4%' }],
        movers: [mover('TSLA.US', 7.2)],
      }),
      1_700_000_000_000
    )
    // portfolio(1) + watchlist mover(1) + watchlist diff(1) + thesis(1) + alert(1) + automation(1)
    expect(brief.items.length).toBe(6)
    for (const item of brief.items) {
      expect(['Portfolio', 'Watchlist', 'Thesis', 'Alert', 'Automation']).toContain(item.source)
    }
  })

  it('flags only material movers as watchlist changes', () => {
    const brief = buildBrief(
      inputs({ movers: [mover('AAPL.US', 1.5), mover('TSLA.US', -6.1)] }),
      1_700_000_000_000
    )
    const watchlist = brief.items.filter((item) => item.source === 'Watchlist')
    expect(watchlist.map((item) => item.symbol)).toEqual(['TSLA.US'])
    expect(watchlist[0]?.severity).toBe('warning')
  })

  it('surfaces material diffs as watchlist items and thesis impacts as thesis items', () => {
    const brief = buildBrief(
      inputs({
        diffs: [
          diff('NVDA.US', true),
          diff('MSFT.US', true, 'invalidated'),
          diff('GOOGL.US', false),
        ],
      }),
      1_700_000_000_000
    )
    const sources = brief.items.map((item) => item.source).sort()
    // NVDA.US material diff → Watchlist; MSFT.US material diff + thesis impact → Watchlist + Thesis
    expect(sources).toEqual(['Thesis', 'Watchlist', 'Watchlist'])
    const thesis = brief.items.find((item) => item.source === 'Thesis')
    expect(thesis?.symbol).toBe('MSFT.US')
    expect(thesis?.severity).toBe('critical')
  })

  it('counts monitored securities without material change into quiet', () => {
    const brief = buildBrief(
      inputs({
        movers: [mover('AAPL.US', 1.5), mover('TSLA.US', -6.1), mover('NVDA.US', 0.2)],
        diffs: [diff('NVDA.US', false)],
      }),
      1_700_000_000_000
    )
    expect(brief.quiet).toEqual({
      count: 2,
      message: '2 monitored securities: no material change',
    })
  })

  it('derives the attention summary from item count', () => {
    const one = buildBrief(inputs({ movers: [mover('TSLA.US', -6.1)] }), 1_700_000_000_000)
    expect(one.summary).toBe('1 thing needs your attention.')
    const three = buildBrief(
      inputs({ movers: [mover('A.US', 6), mover('B.US', 6), mover('C.US', 6)] }),
      1_700_000_000_000
    )
    expect(three.summary).toBe('3 things need your attention.')
  })

  it('orders items deterministically by severity then source', () => {
    const brief = buildBrief(
      inputs({
        runs: [run('r1', 1, true)],
        alerts: [alert('a1', 'AAPL.US', 'alert')],
        movers: [mover('TSLA.US', 7.2)],
      }),
      1_700_000_000_000
    )
    const second = buildBrief(
      inputs({
        runs: [run('r1', 1, true)],
        alerts: [alert('a1', 'AAPL.US', 'alert')],
        movers: [mover('TSLA.US', 7.2)],
      }),
      1_700_000_000_000
    )
    expect(brief.items.map((item) => item.id)).toEqual(second.items.map((item) => item.id))
    // All warning items (Watchlist mover, Alert) sort before Automation info item.
    const severities = brief.items.map((item) => item.severity)
    expect(severities).toEqual(severities.slice().sort())
  })

  it('includes a quiet-only automation run as an info item', () => {
    const brief = buildBrief(
      inputs({ runs: [run('r1', 0, true, 4)] }),
      1_700_000_000_000
    )
    expect(brief.items).toHaveLength(1)
    expect(brief.items[0]?.source).toBe('Automation')
    expect(brief.items[0]?.severity).toBe('info')
    expect(brief.items[0]?.payload).toMatchObject({ evaluated: 4, analyzed: 0 })
  })

  it('drops automation runs that neither found changes nor notified', () => {
    const brief = buildBrief(
      inputs({ runs: [run('r1', 0, false)] }),
      1_700_000_000_000
    )
    expect(brief.items).toEqual([])
  })
})
