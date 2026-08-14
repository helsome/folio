import { createHash } from 'node:crypto'
import type {
  DiffCategory,
  DiffDirection,
  EvidenceRef,
  InvestmentThesis,
  ResearchChange,
  ResearchDiff,
  ResearchReport,
  ResearchSection,
  ResearchVerdict,
} from '@finagent/core'
import {
  CONFIDENCE_LABEL,
  isMaterial,
  isVerdictFlip,
  PRICE_LABEL,
  RATING_LABEL,
  VERDICT_CHANGE_LABEL,
} from './materiality.ts'

/**
 * Structured research diff (spec §17–20).
 *
 * Two reports for the same symbol are compared field-by-field — section
 * verdicts, extractable key metrics (PE, price, target price, rating labels —
 * all via deterministic regexes over evidence summaries), report confidence,
 * and the bull/bear/catalyst/risk lists. Summary prose is never diffed;
 * `capabilityRuns` evidence refs are attached for traceability.
 */

/** Ordered category display order; also the diff output order. */
const CATEGORY_ORDER: DiffCategory[] = [
  'valuation',
  'financials',
  'technical',
  'analyst-rating',
  'momentum',
  'earnings',
  'news',
  'risk',
  'growth',
  'sentiment',
]

/** Canonical section keys and capability-id keys → diff category. */
const SECTION_KEY_CATEGORIES: Record<string, DiffCategory> = {
  // spec keys
  valuation: 'valuation',
  financials: 'financials',
  fundamentals: 'financials',
  technical: 'technical',
  momentum: 'momentum',
  'analyst-rating': 'analyst-rating',
  rating: 'analyst-rating',
  ratings: 'analyst-rating',
  earnings: 'earnings',
  news: 'news',
  risk: 'risk',
  risks: 'risk',
  growth: 'growth',
  sentiment: 'sentiment',
  // capability-id keys (LocalResearchSynthesizer emits these)
  'company.valuation': 'valuation',
  'company.financials': 'financials',
  'company.dividends': 'financials',
  'market.quote': 'technical',
  'market.kline': 'technical',
  'market.intraday': 'technical',
  'market.depth': 'technical',
  'market.trades': 'technical',
  'market.capitalFlow': 'momentum',
  'company.ratings': 'analyst-rating',
  'company.earnings': 'earnings',
  'research.news': 'news',
  'research.events': 'news',
  'market.sentiment': 'sentiment',
}

const VERDICT_SCORE: Record<ResearchVerdict, number> = {
  positive: 1,
  neutral: 0,
  negative: -1,
  // No directional signal — treat as neutral for ordering purposes.
  unavailable: 0,
}

export interface BuildDiffOptions {
  /**
   * When the symbol has an existing thesis, the diff carries a thesisImpact
   * computed by the pure `thesisImpactFromDiff` (no agent, no re-evaluation).
   */
  thesis?: InvestmentThesis
}

/** Stable diff id derived from the two report ids (hash of the pair). */
export function diffIdFor(previousReportId: string, currentReportId: string): string {
  return createHash('sha1')
    .update(`${previousReportId}\u0000${currentReportId}`)
    .digest('hex')
    .slice(0, 16)
}

/**
 * Deterministically compare the previous report against the current one.
 * Every change is stamped with `material` via the shared materiality rules.
 */
export function buildDiff(
  previous: ResearchReport,
  current: ResearchReport,
  options?: BuildDiffOptions
): ResearchDiff {
  const changes = sortChanges([
    ...compareSections(previous, current),
    ...compareMetrics(previous, current),
    ...compareConfidence(previous, current),
    ...compareList(previous, current, 'bullCase', 'growth', 'Bull case point'),
    ...compareList(previous, current, 'bearCase', 'sentiment', 'Bear case point'),
    ...compareList(previous, current, 'catalysts', 'growth', 'Catalyst'),
    ...compareList(previous, current, 'risks', 'risk', 'Risk'),
  ])

  const diff: ResearchDiff = {
    id: diffIdFor(previous.id, current.id),
    symbol: current.symbol,
    previousReportId: previous.id,
    currentReportId: current.id,
    generatedAt: current.generatedAt,
    changes,
    material: changes.some((change) => change.material),
    summary: buildSummary(changes),
  }
  if (options?.thesis) {
    diff.thesisImpact = thesisImpactFromDiff({ changes }, options.thesis)
  }
  return diff
}

// ── Sections ───────────────────────────────────────────────────────────────

function compareSections(previous: ResearchReport, current: ResearchReport): ResearchChange[] {
  const changes: ResearchChange[] = []
  const previousByKey = new Map(previous.sections.map((section) => [section.key, section]))
  const currentKeys = new Set<string>()

  for (const currentSection of current.sections) {
    const category = SECTION_KEY_CATEGORIES[currentSection.key]
    if (category === undefined) continue
    currentKeys.add(currentSection.key)
    const previousSection = previousByKey.get(currentSection.key)
    if (previousSection === undefined) {
      changes.push(
        change(
          category,
          'Section',
          undefined,
          currentSection.title,
          'new',
          evidenceForSection(currentSection)
        )
      )
      continue
    }
    const verdictChange = compareVerdict(category, previousSection, currentSection)
    if (verdictChange) changes.push(verdictChange)
  }

  for (const previousSection of previous.sections) {
    const category = SECTION_KEY_CATEGORIES[previousSection.key]
    if (category === undefined || currentKeys.has(previousSection.key)) continue
    changes.push(
      change(
        category,
        'Section',
        previousSection.title,
        undefined,
        'removed',
        evidenceForSection(previousSection)
      )
    )
  }
  return changes
}

function compareVerdict(
  category: DiffCategory,
  previous: ResearchSection,
  current: ResearchSection
): ResearchChange | undefined {
  if (previous.verdict === current.verdict) return undefined
  const delta = VERDICT_SCORE[current.verdict] - VERDICT_SCORE[previous.verdict]
  if (delta === 0) return undefined
  return change(
    category,
    VERDICT_CHANGE_LABEL,
    previous.verdict,
    current.verdict,
    delta > 0 ? 'improved' : 'worsened',
    evidenceForSection(current)
  )
}

// ── Key metrics (regex over evidence summaries) ────────────────────────────

type MetricKind = 'pe' | 'price' | 'targetPrice' | 'rating'

interface ExtractedMetric {
  kind: MetricKind
  value: number | string
  source: { capabilityId: string; runId: string; fetchedAt: number }
}

const RATING_ORDINAL: Record<string, number> = {
  strong_buy: 5,
  'strong buy': 5,
  buy: 4,
  overweight: 4,
  add: 4,
  outperform: 4,
  hold: 3,
  neutral: 3,
  underweight: 2,
  underperform: 2,
  reduce: 2,
  sell: 1,
  strong_sell: 1,
  'strong sell': 1,
}

const RATING_DISPLAY: Record<string, string> = {
  strong_buy: 'Strong Buy',
  'strong buy': 'Strong Buy',
  buy: 'Buy',
  overweight: 'Overweight',
  add: 'Buy',
  outperform: 'Buy',
  hold: 'Hold',
  neutral: 'Neutral',
  underweight: 'Underweight',
  underperform: 'Underweight',
  reduce: 'Underweight',
  sell: 'Sell',
  strong_sell: 'Sell',
  'strong sell': 'Sell',
}

/**
 * Extract at most one value per metric kind from a report's evidence
 * summaries (first match wins, deterministic order: rating, target price, PE,
 * price). Only summaries of succeeded capability runs are attached as
 * evidence refs, so a metric can only come from real data.
 */
function extractReportMetrics(report: ResearchReport): Partial<Record<MetricKind, ExtractedMetric>> {
  const found: Partial<Record<MetricKind, ExtractedMetric>> = {}
  for (const section of report.sections) {
    for (const ref of section.evidence) {
      const summary = ref.summary ?? ''
      if (found.rating === undefined) {
        const rating = extractRating(summary)
        if (rating !== undefined) found.rating = { kind: 'rating', value: rating, source: sourceOf(ref) }
      }
      if (found.targetPrice === undefined) {
        const target = extractNumber(summary, /\btarget\s*(?:price)?\s*[:=]?\s*\$?([0-9]+(?:\.[0-9]+)?)/i)
        if (target !== undefined) {
          found.targetPrice = { kind: 'targetPrice', value: target, source: sourceOf(ref) }
        }
      }
      if (found.pe === undefined) {
        const pe = extractNumber(summary, /\bPE\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)/i)
        if (pe !== undefined) found.pe = { kind: 'pe', value: pe, source: sourceOf(ref) }
      }
      if (found.price === undefined) {
        const price = extractPrice(summary)
        if (price !== undefined) found.price = { kind: 'price', value: price, source: sourceOf(ref) }
      }
    }
  }
  return found
}

function extractPrice(summary: string): number | undefined {
  // Target-price summaries would otherwise read the consensus target as price.
  if (/target\b/i.test(summary)) return undefined
  // Kline summaries render closes as C$123.45 — take the first (deterministic).
  const close = /\bC\$([0-9]+(?:\.[0-9]+)?)/i.exec(summary)
  if (close) return Number(close[1])
  // Quote summaries lead with the last price, e.g. "[up] NVDA.US: $128.45".
  const dollar = /\$([0-9]+(?:\.[0-9]+)?)/.exec(summary)
  return dollar ? Number(dollar[1]) : undefined
}

function extractRating(summary: string): string | undefined {
  const match =
    /\b(strong_buy|strong buy|strong_sell|strong sell|overweight|outperform|underweight|underperform|buy|add|hold|neutral|reduce|sell)\b/i.exec(
      summary
    )
  if (!match) return undefined
  return RATING_DISPLAY[match[1].toLowerCase()] ?? undefined
}

function extractNumber(summary: string, pattern: RegExp): number | undefined {
  const match = pattern.exec(summary)
  return match ? Number(match[1]) : undefined
}

function compareMetrics(previous: ResearchReport, current: ResearchReport): ResearchChange[] {
  const prev = extractReportMetrics(previous)
  const cur = extractReportMetrics(current)
  const changes: ResearchChange[] = []

  const pe = compareNumberMetric(prev.pe, cur.pe, 'valuation', 'PE ratio', 'worsened')
  if (pe) changes.push(pe)
  const price = compareNumberMetric(prev.price, cur.price, 'technical', PRICE_LABEL, 'improved')
  if (price) changes.push(price)
  const target = compareNumberMetric(
    prev.targetPrice,
    cur.targetPrice,
    'analyst-rating',
    'Target price',
    'improved'
  )
  if (target) changes.push(target)

  if (
    prev.rating &&
    cur.rating &&
    typeof prev.rating.value === 'string' &&
    typeof cur.rating.value === 'string' &&
    prev.rating.value !== cur.rating.value
  ) {
    const beforeOrdinal = RATING_ORDINAL[prev.rating.value.toLowerCase()] ?? 0
    const afterOrdinal = RATING_ORDINAL[cur.rating.value.toLowerCase()] ?? 0
    if (beforeOrdinal !== afterOrdinal) {
      changes.push(
        change(
          'analyst-rating',
          RATING_LABEL,
          prev.rating.value,
          cur.rating.value,
          afterOrdinal > beforeOrdinal ? 'improved' : 'worsened',
          [evidenceString(cur.rating.source)]
        )
      )
    }
  }
  return changes
}

/**
 * One numeric metric pair → a change. `betterWhenHigher` picks the direction:
 * price/target up is improved, PE up is worsened.
 */
function compareNumberMetric(
  before: ExtractedMetric | undefined,
  after: ExtractedMetric | undefined,
  category: DiffCategory,
  label: string,
  betterWhenHigher: 'improved' | 'worsened'
): ResearchChange | undefined {
  if (!before || !after) return undefined
  const beforeValue = typeof before.value === 'number' ? before.value : NaN
  const afterValue = typeof after.value === 'number' ? after.value : NaN
  if (beforeValue === afterValue || !Number.isFinite(beforeValue) || !Number.isFinite(afterValue)) {
    return undefined
  }
  const direction =
    afterValue > beforeValue ? betterWhenHigher : betterWhenHigher === 'improved' ? 'worsened' : 'improved'
  return change(category, label, beforeValue, afterValue, direction, [
    evidenceString(after.source),
  ])
}

// ── Report-level confidence ────────────────────────────────────────────────

function compareConfidence(previous: ResearchReport, current: ResearchReport): ResearchChange[] {
  if (previous.confidence === current.confidence) return []
  return [
    change(
      'sentiment',
      CONFIDENCE_LABEL,
      previous.confidence,
      current.confidence,
      current.confidence > previous.confidence ? 'improved' : 'worsened',
      evidenceFromRuns(current)
    ),
  ]
}

// ── Bull/bear/catalyst/risk lists ──────────────────────────────────────────

type ListKey = 'bullCase' | 'bearCase' | 'catalysts' | 'risks'

function compareList(
  previous: ResearchReport,
  current: ResearchReport,
  key: ListKey,
  category: DiffCategory,
  label: string
): ResearchChange[] {
  const changes: ResearchChange[] = []
  const previousItems = new Set(previous[key])
  const currentItems = new Set(current[key])
  for (const item of current[key]) {
    if (!previousItems.has(item)) {
      changes.push(change(category, label, undefined, item, 'new', []))
    }
  }
  for (const item of previous[key]) {
    if (!currentItems.has(item)) {
      changes.push(change(category, label, item, undefined, 'removed', []))
    }
  }
  return changes
}

// ── Thesis impact (pure, deterministic) ────────────────────────────────────

export type ThesisImpactDirection = 'unchanged' | 'strengthened' | 'weakened' | 'invalidated'

export interface ThesisImpactResult {
  direction: ThesisImpactDirection
  summary: string
}

/**
 * Lightweight thesis impact derived from a diff's material changes — no agent,
 * no re-evaluation (spec: the thesis service owns re-evaluation; this only
 * renders the banner the UI needs).
 *
 *   - material verdict flip: invalidated when it contradicts the thesis stance,
 *     strengthened when it agrees, weakened when there is no stance to test.
 *   - any other material adverse change (worsened, new risk): weakened.
 *   - any other material favorable change (improved, new growth/earnings): strengthened.
 *   - otherwise: unchanged.
 */
export function thesisImpactFromDiff(
  diff: Pick<ResearchDiff, 'changes'>,
  thesis?: Pick<InvestmentThesis, 'stance'>
): ThesisImpactResult {
  const material = diff.changes.filter((c) => c.material)
  const flip = material.find(
    (c) => c.label === VERDICT_CHANGE_LABEL && isVerdictFlip(c.before, c.after)
  )
  if (flip) {
    const flippedTo = String(flip.after)
    if (thesis && thesis.stance !== 'neutral') {
      const contradicts =
        (thesis.stance === 'bullish' && flippedTo === 'negative') ||
        (thesis.stance === 'bearish' && flippedTo === 'positive')
      return contradicts
        ? {
            direction: 'invalidated',
            summary: `A section verdict flipped to ${flippedTo}, against your ${thesis.stance} thesis.`,
          }
        : {
            direction: 'strengthened',
            summary: `A section verdict flipped to ${flippedTo}, in line with your ${thesis.stance} thesis.`,
          }
    }
    return {
      direction: 'weakened',
      summary: `A section verdict flipped from ${String(flip.before)} to ${flippedTo}, reducing conviction.`,
    }
  }

  const adverse = material.some(
    (c) => c.direction === 'worsened' || (c.direction === 'new' && c.category === 'risk')
  )
  const favorable = material.some(
    (c) => c.direction === 'improved' || (c.direction === 'new' && (c.category === 'growth' || c.category === 'earnings'))
  )
  if (adverse) {
    return { direction: 'weakened', summary: `Material adverse changes (${materialLabels(material)}) weaken the thesis.` }
  }
  if (favorable) {
    return { direction: 'strengthened', summary: `Material positive changes (${materialLabels(material)}) strengthen the thesis.` }
  }
  return { direction: 'unchanged', summary: 'No material changes to the thesis.' }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function change(
  category: DiffCategory,
  label: string,
  before: string | number | undefined,
  after: string | number | undefined,
  direction: DiffDirection,
  evidence: string[]
): ResearchChange {
  const partial: ResearchChange = {
    category,
    label,
    before,
    after,
    direction,
    material: false,
    evidence,
  }
  return { ...partial, material: isMaterial(partial) }
}

function evidenceForSection(section: ResearchSection): string[] {
  return section.evidence.map((ref) => evidenceString(sourceOf(ref)))
}

function sourceOf(ref: EvidenceRef): { capabilityId: string; runId: string; fetchedAt: number } {
  return { capabilityId: ref.capabilityId, runId: ref.runId, fetchedAt: ref.fetchedAt }
}

function evidenceString(source: { capabilityId: string; runId: string; fetchedAt: number }): string {
  return `capability:${source.capabilityId} run:${source.runId} fetchedAt:${source.fetchedAt}`
}

function evidenceFromRuns(report: ResearchReport): string[] {
  return report.capabilityRuns.map(
    (run) => `capability:${run.capabilityId} run:${run.runId} fetchedAt:${run.fetchedAt ?? 'n/a'}`
  )
}

function sortChanges(changes: ResearchChange[]): ResearchChange[] {
  return [...changes].sort((a, b) => {
    const categoryDelta = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category)
    if (categoryDelta !== 0) return categoryDelta
    if (a.label !== b.label) return a.label.localeCompare(b.label)
    return String(a.before ?? '').localeCompare(String(b.before ?? ''))
  })
}

function buildSummary(changes: ResearchChange[]): string {
  if (changes.length === 0) return 'No changes since the previous report.'
  const material = changes.filter((c) => c.material)
  if (material.length === 0) {
    return `${changes.length} minor change(s) since the previous report — nothing material.`
  }
  const labels = material.map((c) => `${c.label} (${c.category})`)
  return `${material.length} material change(s): ${labels.join(', ')}.`
}

function materialLabels(changes: ResearchChange[]): string {
  return changes.map((c) => c.label).join(', ')
}
