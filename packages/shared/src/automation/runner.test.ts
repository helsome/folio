import { describe, expect, it } from 'bun:test'
import { Type } from '@sinclair/typebox'
import type {
  AutomationRule,
  CalendarEvent,
  CapabilityRegistry,
  FinanceCapability,
  NotificationEvent,
  Quote,
  ResearchDiff,
} from '@finagent/core'
import { defineCapability } from '../capabilities/define.ts'
import { createCapabilityRegistry } from '../capabilities/registry.ts'
import type { ResearchDiffRepository } from '../research-diff/repository.ts'
import {
  runAutomation,
  signalsAreMaterial,
  type AutomationRunContext,
  type MaterialSignals,
} from './runner.ts'

function quote(lastPrice: number, prevClose: number, symbol = 'AAPL.US'): Quote {
  return {
    symbol,
    lastPrice,
    prevClose,
    change: lastPrice - prevClose,
    changePercent: ((lastPrice - prevClose) / prevClose) * 100,
    volume: 1000,
    timestamp: 1_700_000_000,
    high: Math.max(lastPrice, prevClose),
    low: Math.min(lastPrice, prevClose),
    open: prevClose,
  }
}

function quoteCapability(quotes: Record<string, Quote>): FinanceCapability<{ symbol: string }, Quote> {
  return defineCapability<{ symbol: string }, Quote>({
    id: 'market.quote',
    name: 'Quote',
    description: 'test quote',
    category: 'market',
    riskLevel: 'read',
    auth: 'public',
    toolName: 'get_quote',
    inputSchema: Type.Object({ symbol: Type.String() }),
    async execute(input) {
      const found = quotes[input.symbol]
      if (!found) throw new Error(`no quote for ${input.symbol}`)
      return {
        data: found,
        provenance: { provider: 'test', fetchedAt: 1_700_000_000, stale: false },
        summary: `${found.symbol} ok`,
      }
    },
  })
}

function eventsCapability(events: CalendarEvent[]): FinanceCapability<{ symbol: string }, CalendarEvent[]> {
  return defineCapability<{ symbol: string }, CalendarEvent[]>({
    id: 'research.events',
    name: 'Finance Calendar',
    description: 'test calendar',
    category: 'research',
    riskLevel: 'read',
    auth: 'public',
    toolName: 'get_calendar_events',
    inputSchema: Type.Object({
      eventType: Type.String(),
      symbols: Type.Optional(Type.Array(Type.String())),
      count: Type.Optional(Type.Number()),
    }),
    async execute() {
      return {
        data: events,
        provenance: { provider: 'test', fetchedAt: 1_700_000_000, stale: false },
        summary: `${events.length} events`,
      }
    },
  })
}

function diff(symbol: string, material: boolean): ResearchDiff {
  return {
    id: `diff-${symbol}`,
    symbol,
    previousReportId: 'prev',
    currentReportId: 'cur',
    generatedAt: 1_700_000_000_000,
    changes: [],
    material,
    summary: material ? 'material change' : 'no change',
  }
}

function diffRepo(bySymbol: Record<string, ResearchDiff>): ResearchDiffRepository {
  return {
    getBySymbol: async (symbol: string) => bySymbol[symbol.toUpperCase()],
  } as unknown as ResearchDiffRepository
}

function rule(overrides: Partial<AutomationRule>): AutomationRule {
  return {
    id: 'rule-1',
    type: 'watchlist-daily-review',
    enabled: true,
    notify: 'material-only',
    createdAt: 1_700_000_000_000,
    ...overrides,
  }
}

interface ContextResult {
  context: AutomationRunContext
  researchCalls: string[]
  notifications: NotificationEvent[]
}

function makeContext(options: {
  quotes?: Record<string, Quote>
  diffs?: Record<string, ResearchDiff>
  events?: CalendarEvent[]
  rule?: AutomationRule
}): ContextResult {
  const researchCalls: string[] = []
  const notifications: NotificationEvent[] = []
  const caps: FinanceCapability[] = [quoteCapability(options.quotes ?? {})]
  if (options.events !== undefined) caps.push(eventsCapability(options.events))
  const registry = createCapabilityRegistry(caps)

  const context: AutomationRunContext = {
    registry: registry as unknown as CapabilityRegistry,
    diffRepo: diffRepo(options.diffs ?? {}),
    researchStart: async (symbol: string) => {
      researchCalls.push(symbol)
    },
    notify: async (event: NotificationEvent) => {
      notifications.push(event)
    },
    idGen: () => 'run-1',
    now: () => 1_700_000_000_000,
  }
  return { context, researchCalls, notifications }
}

describe('signalsAreMaterial', () => {
  it('crosses the bar on a ≥5% price move', () => {
    expect(signalsAreMaterial({ priceMovePct: 5, diffMaterial: false, ratingChanged: false, earningsAnnounced: false })).toBe(true)
    expect(signalsAreMaterial({ priceMovePct: 4.9, diffMaterial: false, ratingChanged: false, earningsAnnounced: false })).toBe(false)
  })

  it('crosses the bar on diff, rating, or earnings signals', () => {
    const base: MaterialSignals = { priceMovePct: 0.5, diffMaterial: false, ratingChanged: false, earningsAnnounced: false }
    expect(signalsAreMaterial({ ...base, diffMaterial: true })).toBe(true)
    expect(signalsAreMaterial({ ...base, ratingChanged: true })).toBe(true)
    expect(signalsAreMaterial({ ...base, earningsAnnounced: true })).toBe(true)
  })
})

describe('runAutomation scope resolution', () => {
  it('resolves watchlist scope from the injected provider', async () => {
    const { context } = makeContext({
      quotes: { 'AAPL.US': quote(100, 100), 'MSFT.US': quote(50, 50) },
    })
    context.watchlistSymbols = async () => ['AAPL.US', 'MSFT.US']
    const run = await runAutomation(rule({}), context)
    expect(run.evaluated).toBe(2)
    expect(run.failures).toEqual([])
  })

  it('resolves portfolio and thesis scopes from their providers', async () => {
    const { context } = makeContext({ quotes: { 'AAPL.US': quote(100, 100) } })
    context.portfolioSymbols = async () => ['AAPL.US']
    expect((await runAutomation(rule({ type: 'portfolio-daily-brief' }), context)).evaluated).toBe(1)

    const thesisContext = makeContext({ quotes: { 'AAPL.US': quote(100, 100) } })
    thesisContext.context.thesisSymbols = async () => ['AAPL.US']
    expect(
      (await runAutomation(rule({ type: 'weekly-thesis-review' }), thesisContext.context)).evaluated
    ).toBe(1)
  })

  it('prefers rule.symbols over the type provider', async () => {
    const { context } = makeContext({ quotes: { 'AAPL.US': quote(100, 100) } })
    context.watchlistSymbols = async () => ['MSFT.US']
    const run = await runAutomation(
      rule({ symbols: ['AAPL.US'] }),
      context
    )
    expect(run.evaluated).toBe(1)
    expect(run.failures).toEqual([])
  })

  it('uses the hook scope for event-driven earnings rules', async () => {
    const { context } = makeContext({ quotes: { 'AAPL.US': quote(100, 100) } })
    const run = await runAutomation(
      rule({ type: 'pre-earnings-research', symbols: ['AAPL.US'] }),
      context
    )
    expect(run.evaluated).toBe(1)
  })

  it('records a failure when no scope provider is wired', async () => {
    const { context } = makeContext({ quotes: { 'AAPL.US': quote(100, 100) } })
    const run = await runAutomation(rule({}), context)
    expect(run.evaluated).toBe(0)
    expect(run.failures).toEqual(['no symbols in scope for watchlist-daily-review'])
  })
})

describe('runAutomation material filter', () => {
  it('never researches non-material symbols', async () => {
    const { context, researchCalls, notifications } = makeContext({
      quotes: { 'AAPL.US': quote(100, 100) }, // 0% move, no diff
    })
    context.watchlistSymbols = async () => ['AAPL.US']
    const run = await runAutomation(rule({}), context)
    expect(run.evaluated).toBe(1)
    expect(run.materialChanges).toBe(0)
    expect(run.analyzed).toBe(0)
    expect(run.notified).toBe(false)
    expect(researchCalls).toEqual([])
    expect(notifications).toEqual([])
  })

  it('researches a material price move exactly once', async () => {
    const { context, researchCalls, notifications } = makeContext({
      quotes: { 'AAPL.US': quote(106, 100) }, // 6% move
    })
    context.watchlistSymbols = async () => ['AAPL.US']
    const run = await runAutomation(rule({}), context)
    expect(run.materialChanges).toBe(1)
    expect(run.analyzed).toBe(1)
    expect(run.notified).toBe(true)
    expect(researchCalls).toEqual(['AAPL.US'])
    expect(notifications).toHaveLength(1)
    expect(notifications[0]?.severity).toBe('warning')
    expect(notifications[0]?.symbol).toBe('AAPL.US')
    expect(notifications[0]?.source).toBe('automation')
  })

  it('localizes the automation notification copy per locale (spec §47, §80)', async () => {
    const en = makeContext({ quotes: { 'AAPL.US': quote(106, 100) } })
    en.context.locale = 'en-US'
    en.context.watchlistSymbols = async () => ['AAPL.US']
    await runAutomation(rule({}), en.context)
    expect(en.notifications[0]?.title).toContain('AAPL.US')
    expect(en.notifications[0]?.title).toMatch(/attention/i)
    expect(en.notifications[0]?.message).toMatch(/material change/i)

    const zh = makeContext({ quotes: { 'NVDA.US': quote(106, 100) } })
    zh.context.locale = 'zh-CN'
    zh.context.watchlistSymbols = async () => ['NVDA.US']
    await runAutomation(rule({}), zh.context)
    expect(zh.notifications[0]?.title).toContain('NVDA.US')
    expect(zh.notifications[0]?.title).toContain('需要关注')
    expect(zh.notifications[0]?.message).toContain('重要变化')
    // The stable type id stays untouched in the structured payload.
    expect(zh.notifications[0]?.payload?.ruleType).toBe('watchlist-daily-review')
  })

  it('researches a symbol with a material research diff', async () => {
    const { context, researchCalls } = makeContext({
      quotes: { 'NVDA.US': quote(100, 100) },
      diffs: { 'NVDA.US': diff('NVDA.US', true) },
    })
    context.watchlistSymbols = async () => ['NVDA.US']
    const run = await runAutomation(rule({}), context)
    expect(run.materialChanges).toBe(1)
    expect(researchCalls).toEqual(['NVDA.US'])
  })

  it('detects earnings announcements via the calendar capability', async () => {
    const announced: CalendarEvent = {
      id: 'e1',
      date: 1_700_000_000, // <= now (1_700_000_000_000 ms)
      type: 'report',
      symbol: 'AAPL.US',
    }
    const { context, researchCalls } = makeContext({
      quotes: { 'AAPL.US': quote(100, 100) },
      events: [announced],
    })
    context.watchlistSymbols = async () => ['AAPL.US']
    const run = await runAutomation(rule({}), context)
    expect(run.materialChanges).toBe(1)
    expect(researchCalls).toEqual(['AAPL.US'])
  })

  it('skips symbols whose quote is unavailable', async () => {
    const { context, researchCalls } = makeContext({
      quotes: { 'AAPL.US': quote(106, 100) },
    })
    context.watchlistSymbols = async () => ['AAPL.US', 'MSFT.US'] // MSFT.US has no quote
    const run = await runAutomation(rule({}), context)
    expect(run.evaluated).toBe(1)
    expect(run.materialChanges).toBe(1)
    expect(run.failures).toEqual(['MSFT.US: quote unavailable'])
    expect(researchCalls).toEqual(['AAPL.US'])
  })

  it('passes the rule strategyId into researchStart', async () => {
    const { context, researchCalls } = makeContext({
      quotes: { 'AAPL.US': quote(106, 100) },
    })
    context.watchlistSymbols = async () => ['AAPL.US']
    await runAutomation(rule({ strategyId: 'event-driven' }), context)
    expect(researchCalls).toEqual(['AAPL.US'])
  })
})

describe('runAutomation notify semantics', () => {
  it('notifies every evaluated symbol when notify=all, without researching', async () => {
    const { context, researchCalls, notifications } = makeContext({
      quotes: { 'AAPL.US': quote(100, 100), 'MSFT.US': quote(50, 50) },
    })
    context.watchlistSymbols = async () => ['AAPL.US', 'MSFT.US']
    const run = await runAutomation(rule({ notify: 'all' }), context)
    expect(run.notified).toBe(true)
    expect(run.materialChanges).toBe(0)
    expect(researchCalls).toEqual([])
    expect(notifications.map((n) => n.severity)).toEqual(['info', 'info'])
    expect(notifications.map((n) => n.symbol)).toEqual(['AAPL.US', 'MSFT.US'])
  })

  it('notifies only material symbols with material-only mode', async () => {
    const { context, notifications } = makeContext({
      quotes: { 'AAPL.US': quote(106, 100), 'MSFT.US': quote(50, 50) },
    })
    context.watchlistSymbols = async () => ['AAPL.US', 'MSFT.US']
    await runAutomation(rule({}), context)
    expect(notifications.map((n) => n.symbol)).toEqual(['AAPL.US'])
  })
})
