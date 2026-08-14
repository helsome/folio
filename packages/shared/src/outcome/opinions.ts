import type { OpinionHorizon, ResearchOpinion, ResearchReport } from '@finagent/core'
import { isStrategyId, RESEARCH_STRATEGIES } from '../strategies/index.ts'

/**
 * Opinion factory (spec §29–31). Snapshots a completed ResearchReport into a
 * ResearchOpinion at persist time. The snapshot is write-once: evaluation
 * later reads the opinion, never the (possibly changed) report.
 */

export interface CreateOpinionOptions {
  /** Committed evaluation horizon; defaults to '1m' (Lead decision). */
  horizon?: OpinionHorizon
  /** Data provider that produced the report, when known. */
  provider?: string
  /** Creation timestamp (ms). Defaults to Date.now(). */
  now?: number
}

export const OPINION_DEFAULT_HORIZON: OpinionHorizon = '1m'

/**
 * Best-effort entry snapshot from the report (spec §31 — never backfilled).
 *
 * The report's `capabilityRuns` summaries carry no raw values (see
 * packages/shared/src/research/runner.ts: only run id/status/provenance are
 * embedded), so the only honest in-report source is a `market.quote` evidence
 * ref whose summary embeds the quote price. The runner attaches such evidence
 * when a synthesizer section is keyed by the capability id; today's
 * synthesizers do not, so this usually returns undefined and the engine falls
 * back to the first history close — or records `unable`/`entry-unknown`.
 */
export function extractEntryPrice(report: ResearchReport): number | undefined {
  for (const section of report.sections) {
    for (const ref of section.evidence) {
      if (ref.capabilityId !== 'market.quote') continue
      if (typeof ref.summary !== 'string') continue
      // The quote summary leads with the last price: `[up] AAPL.US: $150.00`.
      const match = /\$([0-9]+(?:\.[0-9]+)?)/.exec(ref.summary)
      if (match) {
        const price = Number(match[1])
        if (Number.isFinite(price) && price > 0) return price
      }
    }
  }
  return undefined
}

/** Newest fetchedAt across the report's capability runs (ms). */
function newestFetchedAt(report: ResearchReport): number | undefined {
  let newest: number | undefined
  for (const run of report.capabilityRuns) {
    if (run.fetchedAt !== undefined && (newest === undefined || run.fetchedAt > newest)) {
      newest = run.fetchedAt
    }
  }
  return newest
}

/** Unique capability run ids backing the opinion, in section order. */
function collectEvidenceRunIds(report: ResearchReport): string[] {
  const seen = new Set<string>()
  const refs: string[] = []
  for (const section of report.sections) {
    for (const ref of section.evidence) {
      if (!seen.has(ref.runId)) {
        seen.add(ref.runId)
        refs.push(ref.runId)
      }
    }
  }
  return refs
}

/** Skill lineage from the strategy preset map; empty for unknown strategies. */
function skillIdsFor(strategyId: string | undefined): string[] {
  if (strategyId === undefined) return []
  if (!isStrategyId(strategyId)) return []
  return RESEARCH_STRATEGIES[strategyId].skillIds
}

export function createOpinion(
  report: ResearchReport,
  options: CreateOpinionOptions = {}
): ResearchOpinion {
  return {
    id: `opinion-${report.id}`,
    reportId: report.id,
    symbol: report.symbol,
    strategyId: report.strategyId,
    skillIds: skillIdsFor(report.strategyId),
    stance: report.stance,
    confidence: report.confidence,
    horizon: options.horizon ?? OPINION_DEFAULT_HORIZON,
    createdAt: options.now ?? Date.now(),
    entryPrice: extractEntryPrice(report),
    provider: options.provider,
    dataTimestamp: newestFetchedAt(report),
    evidenceRefs: collectEvidenceRunIds(report),
  }
}
