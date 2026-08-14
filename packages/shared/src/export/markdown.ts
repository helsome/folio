import type { ResearchReport, ResearchStance, ResearchVerdict } from '@finagent/core'
import { isStrategyId, RESEARCH_STRATEGIES } from '../strategies/index.ts'

/**
 * Deterministic Markdown renderer for a ResearchReport (spec §54 Export).
 *
 * Pure function — no I/O, no `Date.now()`, no locale-dependent formatting —
 * so main-process IPC handlers and tests get byte-identical output for the
 * same report. The evidence list is the source-of-truth layer: every claim
 * stays linked to the capability run that produced it.
 */

export interface MarkdownOptions {
  /** Append the evidence list (section title + claim + capability + run id). Default true. */
  includeEvidence?: boolean
  /** Print the research strategy badge line. Default true. */
  includeStrategy?: boolean
}

export const STANCE_LABEL: Record<ResearchStance, string> = {
  bullish: 'Bullish',
  bearish: 'Bearish',
  neutral: 'Neutral',
}

export const VERDICT_LABEL: Record<ResearchVerdict, string> = {
  positive: 'Positive',
  negative: 'Negative',
  neutral: 'Neutral',
  unavailable: 'Unavailable',
}

/** Display name of a research strategy id, or undefined for unknown/none. */
export function strategyName(strategyId: string | undefined): string | undefined {
  if (!strategyId || !isStrategyId(strategyId)) return undefined
  return RESEARCH_STRATEGIES[strategyId].name
}

function pushList(lines: string[], points: string[]): void {
  lines.push('')
  if (points.length === 0) {
    lines.push('_None listed._')
    return
  }
  for (const point of points) lines.push(`- ${point}`)
}

export function reportToMarkdown(report: ResearchReport, options: MarkdownOptions = {}): string {
  const { includeEvidence = true, includeStrategy = true } = options
  const lines: string[] = []

  lines.push(`# ${report.symbol} — Research Report`)
  lines.push('')

  const meta: string[] = [`Generated ${new Date(report.generatedAt).toISOString()}`]
  const strategy = strategyName(report.strategyId)
  if (includeStrategy && strategy) meta.unshift(`Strategy: ${strategy}`)
  lines.push(`**${STANCE_LABEL[report.stance].toUpperCase()}** · Confidence: ${Math.round(report.confidence * 100)}% · ${meta.join(' · ')}`)
  lines.push('')
  lines.push(report.summary)
  lines.push('')

  lines.push('## Sections')
  for (const section of report.sections) {
    lines.push('')
    lines.push(`### ${section.title} — ${VERDICT_LABEL[section.verdict]}`)
    lines.push('')
    lines.push(section.summary || '_No summary._')
  }

  lines.push('')
  lines.push('## Bull Case')
  pushList(lines, report.bullCase)
  lines.push('')
  lines.push('## Bear Case')
  pushList(lines, report.bearCase)
  lines.push('')
  lines.push('## Catalysts')
  pushList(lines, report.catalysts)
  lines.push('')
  lines.push('## Risks')
  pushList(lines, report.risks)

  if (includeEvidence) {
    lines.push('')
    lines.push('## Evidence')
    const refs = report.sections.flatMap((section) =>
      section.evidence.map((ref) => ({
        sectionTitle: section.title,
        claim: ref.claim,
        capabilityId: ref.capabilityId,
        runId: ref.runId,
      }))
    )
    if (refs.length === 0) {
      lines.push('')
      lines.push('_None listed._')
    } else {
      for (const ref of refs) {
        lines.push('')
        lines.push(`- ${ref.sectionTitle}: ${ref.claim || '(claim not recorded)'} — ${ref.capabilityId} (run ${ref.runId})`)
      }
    }
  }

  return `${lines.join('\n').trim()}\n`
}
