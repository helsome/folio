import { atom } from 'jotai'
import type { CalendarEvent, InvestmentThesis, Quote } from '@finagent/core'
import { quoteCacheAtomFamily, watchlistAtom } from './quoteAtoms'

/**
 * "Today" dashboard selectors (spec §31–32).
 *
 * Every value here is derived from already-normalized domain data (quotes,
 * theses, calendar events). The selectors are pure and unit-tested; the view
 * layers above them render the loading/error/empty states so a missing IPC
 * channel degrades gracefully instead of producing NaN/undefined rows.
 */

/** How many watchlist movers the dashboard surfaces. */
export const MOVER_LIMIT = 5

/** A compact mover row: symbol + last price + day change %, ready to render. */
export interface WatchlistMover {
  symbol: string
  lastPrice?: number
  changePercent?: number
}

/**
 * Top absolute movers among a set of quotes, biggest |change %| first.
 * Non-finite values are dropped so the view never renders NaN.
 */
export function topMovers(quotes: Quote[], limit: number = MOVER_LIMIT): WatchlistMover[] {
  return quotes
    .filter((quote) => quote != null && Number.isFinite(quote.changePercent))
    .slice()
    .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
    .slice(0, limit)
    .map((quote) => ({
      symbol: quote.symbol,
      lastPrice: Number.isFinite(quote.lastPrice) ? quote.lastPrice : undefined,
      changePercent: quote.changePercent,
    }))
}

/** Movers derived from the watchlist + the quote cache (no fetch here). */
export const watchlistMoversAtom = atom<WatchlistMover[]>((get) => {
  const symbols = get(watchlistAtom)
  const quotes = symbols
    .map((symbol) => get(quoteCacheAtomFamily(symbol)).data)
    .filter((quote): quote is Quote => quote != null)
  return topMovers(quotes)
})

/**
 * Theses that need a fresh review. The core `InvestmentThesis` contract has no
 * status field, so "needs review" = the thesis changed after its last review
 * (`lastReviewedAt < updatedAt`); a never-reviewed thesis has `lastReviewedAt`
 * of 0 and therefore qualifies.
 */
export function thesesNeedingReview(theses: InvestmentThesis[]): InvestmentThesis[] {
  return theses.filter(
    (thesis) => thesis != null && thesis.lastReviewedAt < thesis.updatedAt,
  )
}

/** A normalized upcoming calendar event row. */
export interface UpcomingEventItem {
  id: string
  symbol: string
  type: string
  activityType?: string
  name?: string
  content?: string
  /** Epoch seconds of the event. */
  date: number
  localDate?: string
}

/**
 * Map raw calendar events to upcoming display rows (future-only, soonest
 * first). `nowSeconds` is injectable for tests.
 */
export function mapUpcomingEvents(
  events: CalendarEvent[],
  nowSeconds: number = Date.now() / 1000,
  limit: number = 10,
): UpcomingEventItem[] {
  return events
    .filter((event) => event != null && Number.isFinite(event.date) && event.date >= nowSeconds)
    .slice()
    .sort((a, b) => a.date - b.date)
    .slice(0, limit)
    .map((event) => ({
      id: event.id,
      symbol: event.symbol ?? '',
      type: event.type ?? '',
      activityType: event.activityType,
      name: event.name,
      content: event.content,
      date: event.date,
      localDate: event.localDate,
    }))
}
