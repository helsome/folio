import type { Kline, ResearchOpinion, ResearchOutcome, ResearchReport } from '@finagent/core'
import { OutcomeEngine } from './engine.ts'
import { createOpinion } from './opinions.ts'
import type { OutcomeRepository } from './repository.ts'

/**
 * Application-facing outcome API (spec §29–38).
 *
 * `createOpinionFromReport` snapshots a completed report at persist time
 * (kernelHost integration point). `evaluateDue` runs every opinion whose
 * horizon has elapsed and stores the results; the caller injects a
 * `historyFetcher` wired to the CapabilityExecutor `market.kline` capability
 * so this module never touches provider code directly.
 */

/** Fetches post-creation price history for one symbol (ascending bars). */
export type HistoryFetcher = (symbol: string) => Promise<Kline[] | null>

export interface OutcomeServiceOptions {
  repository: OutcomeRepository
  now?: () => number
}

export class OutcomeService {
  private readonly repository: OutcomeRepository
  private readonly now: () => number
  private readonly engine: OutcomeEngine

  constructor(options: OutcomeServiceOptions) {
    this.repository = options.repository
    this.now = options.now ?? Date.now
    this.engine = new OutcomeEngine()
  }

  /** Snapshot a report into a persisted opinion (idempotent per report id). */
  async createOpinionFromReport(report: ResearchReport): Promise<ResearchOpinion> {
    const opinion = createOpinion(report, { now: this.now() })
    await this.repository.saveOpinion(opinion)
    return opinion
  }

  /**
   * Evaluate every due opinion. History is fetched once per symbol per call
   * (a symbol may have several due opinions). Without an injected fetcher the
   * call is a documented no-op — there is no data source to evaluate against.
   */
  async evaluateDue(nowMs?: number, historyFetcher?: HistoryFetcher): Promise<ResearchOutcome[]> {
    if (!historyFetcher) return []
    const at = nowMs ?? this.now()
    const due = await this.repository.listDueOpinions(at)
    if (due.length === 0) return []

    const historyCache = new Map<string, Kline[] | null>()
    const outcomes: ResearchOutcome[] = []
    for (const opinion of due) {
      let history = historyCache.get(opinion.symbol)
      if (history === undefined) {
        history = (await historyFetcher(opinion.symbol)) ?? null
        historyCache.set(opinion.symbol, history)
      }
      const outcome = this.engine.evaluate(opinion, history, { now: at })
      await this.repository.saveOutcome(outcome)
      outcomes.push(outcome)
    }
    return outcomes
  }
}
