import { atom } from 'jotai'
import type { ScreeningCandidate, ScreeningRun, ScreeningStrategy, StrategyId } from '@finagent/core'

/**
 * Discover view state + task metadata.
 *
 * The 17 task definitions mirror `packages/shared/src/screening/strategies.ts`
 * (title/description/family). The UI cannot import `@finagent/shared` — that
 * package drags node/executor code into the renderer — so the metadata is
 * duplicated here by convention (same pattern as the diagnostics bundle
 * mirror). Keep the two in sync when tasks change.
 */

export type StrategyFamily = 'market-movers' | 'fundamental' | 'technical' | 'events'

export interface DiscoverTask {
  id: ScreeningStrategy
  title: string
  description: string
  family: StrategyFamily
}

export const FAMILY_LABELS: Record<StrategyFamily, string> = {
  'market-movers': 'Market Movers',
  fundamental: 'Fundamental',
  technical: 'Technical',
  events: 'Events',
}

export const DISCOVER_TASKS: DiscoverTask[] = [
  { id: 'top-gainers', title: 'Top Gainers', description: 'Biggest single-day price gains in the universe.', family: 'market-movers' },
  { id: 'top-losers', title: 'Top Losers', description: 'Biggest single-day price declines in the universe.', family: 'market-movers' },
  { id: 'high-volume', title: 'High Volume', description: 'Unusual trading volume versus each stock\u2019s recent baseline.', family: 'market-movers' },
  { id: 'unusual-movement', title: 'Unusual Movement', description: 'Price amplitude well beyond each stock\u2019s recent range.', family: 'market-movers' },
  { id: 'low-valuation', title: 'Low Valuation', description: 'Cheap on price-to-earnings and/or price-to-book.', family: 'fundamental' },
  { id: 'high-roe', title: 'High ROE', description: 'Efficient capital use — return on equity above the bar.', family: 'fundamental' },
  { id: 'revenue-growth', title: 'Revenue Growth', description: 'Top-line growth — latest reported YoY revenue increase.', family: 'fundamental' },
  { id: 'high-dividend', title: 'High Dividend', description: 'Attractive dividend yield with a real payment history.', family: 'fundamental' },
  { id: 'quality-growth', title: 'Quality Growth', description: 'Growth that is profitable — ROE, margin and revenue together.', family: 'fundamental' },
  { id: 'strong-momentum', title: 'Strong Momentum', description: 'Sustained upside — strong 1m and 3m returns.', family: 'technical' },
  { id: 'breakout', title: 'Breakout', description: 'New highs on expanding volume.', family: 'technical' },
  { id: 'oversold', title: 'Oversold', description: 'Deep pullback — price well below its short-term average.', family: 'technical' },
  { id: 'trend-reversal', title: 'Trend Reversal', description: 'Downtrend showing its first sign of turning up.', family: 'technical' },
  { id: 'upcoming-earnings', title: 'Upcoming Earnings', description: 'Earnings announcements inside the next 30 days.', family: 'events' },
  { id: 'rating-changes', title: 'Rating Changes', description: 'Buy-consensus names with meaningful analyst upside.', family: 'events' },
  { id: 'news-surge', title: 'News Surge', description: 'A burst of recent headlines — a stock in the news.', family: 'events' },
  { id: 'dividend-events', title: 'Dividend Events', description: 'Ex-dividend dates arriving within the next 90 days.', family: 'events' },
]

export function tasksByFamily(family: StrategyFamily): DiscoverTask[] {
  return DISCOVER_TASKS.filter((task) => task.family === family)
}

export const FAMILY_ORDER: StrategyFamily[] = ['market-movers', 'fundamental', 'technical', 'events']

/**
 * Screening task → recommended `ResearchStrategy` (carried into Research when
 * the user runs deep research from a candidate). Families map per the V5
 * contract: market-movers → technical, technical → technical, events →
 * event-driven, fundamental → value/growth by task.
 */
export const RESEARCH_STRATEGY_BY_TASK: Record<ScreeningStrategy, StrategyId> = {
  'top-gainers': 'technical',
  'top-losers': 'technical',
  'high-volume': 'technical',
  'unusual-movement': 'technical',
  'low-valuation': 'value',
  'high-roe': 'growth',
  'revenue-growth': 'growth',
  'high-dividend': 'value',
  'quality-growth': 'growth',
  'strong-momentum': 'technical',
  'breakout': 'technical',
  'oversold': 'technical',
  'trend-reversal': 'technical',
  'upcoming-earnings': 'event-driven',
  'rating-changes': 'event-driven',
  'news-surge': 'event-driven',
  'dividend-events': 'event-driven',
}

// ── Run state ───────────────────────────────────────────────────────────────

/** The task currently running (drives the per-task spinner); null when idle. */
export const screeningRunningStrategyAtom = atom<ScreeningStrategy | null>(null)

/** Candidates of the latest completed run; null before the first run. */
export const screeningResultsAtom = atom<ScreeningCandidate[] | null>(null)

/** The latest completed run (strategy + failures + evidence for the UI). */
export const screeningLastRunAtom = atom<ScreeningRun | null>(null)

export const screeningErrorAtom = atom<string | null>(null)

/** Previous-runs history (spec §10), newest first. */
export const screeningRunsAtom = atom<ScreeningRun[]>([])

/**
 * Recommended research strategy carried into the Research section when the
 * user acts on a candidate. The ResearchPanel (B/Lead integration) reads and
 * clears this to seed `research.start` with the strategy id.
 */
export const pendingResearchStrategyAtom = atom<StrategyId | null>(null)

/**
 * Lightweight origin context (V9 §54): where the user entered Research from.
 * ResearchPanel shows a contextual back chip and returns to that section,
 * instead of leaving the user with no path back to their results.
 */
export type ResearchOrigin = { from: 'discover' | 'portfolio' | 'today'; label: string }

export const researchOriginAtom = atom<ResearchOrigin | null>(null)


