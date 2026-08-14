/**
 * Portfolio import drafts (spec §93): parse → draft → confirm → persist.
 *
 * Creating a draft has ZERO side effects — nothing is written to disk until
 * the user confirms. Confirmation converts draft rows into holdings and
 * persists them via the ManualPortfolioRepository.
 */
import { randomUUID } from 'node:crypto'
import type {
  Holding,
  ImportSource,
  ManualPortfolio,
  PortfolioImportDraft,
  PortfolioImportRow,
} from '@finagent/core'

/** Generate a unique draft id. */
export function createDraftId(): string {
  return `draft_${randomUUID()}`
}

/** Generate a unique manual portfolio id. */
export function createPortfolioId(): string {
  return `manual_${randomUUID()}`
}

/** Warnings summarizing a draft for the review screen. */
export function draftWarnings(rows: PortfolioImportRow[]): string[] {
  const warnings: string[] = []
  const lowConfidence = rows.filter((row) => row.confidence < 1).length
  if (lowConfidence > 0) {
    warnings.push(`${lowConfidence} row${lowConfidence === 1 ? '' : 's'} need${lowConfidence === 1 ? 's' : ''} review`)
  }
  const withIssues = rows.filter((row) => row.issues.length > 0).length
  if (withIssues > 0) {
    warnings.push(`${withIssues} row${withIssues === 1 ? '' : 's'} contain${withIssues === 1 ? 's' : ''} issues that were kept for review`)
  }
  const duplicates = rows.filter((row) => row.issues.some((issue) => issue.startsWith('Duplicate symbol'))).length
  if (duplicates > 0) {
    warnings.push(`${duplicates} duplicate symbol${duplicates === 1 ? '' : 's'} flagged`)
  }
  const empty = rows.filter((row) => row.symbol === '').length
  if (empty > 0) {
    warnings.push(`${empty} row${empty === 1 ? '' : 's'} with no recognizable symbol`)
  }
  return warnings
}

/** Build a draft from parsed rows. Purely in-memory — persists nothing. */
export function createDraft(source: ImportSource, rows: PortfolioImportRow[]): PortfolioImportDraft {
  return {
    id: createDraftId(),
    source,
    rows,
    importedAt: Date.now(),
    warnings: draftWarnings(rows),
  }
}

/**
 * Re-validate a draft before confirmation. Returns every per-row issue plus
 * structural problems; an empty array means the draft is clean. The caller
 * (UI/main) decides whether issues block confirmation — low-confidence rows
 * are reviewable, not rejected.
 */
export function validateDraft(draft: PortfolioImportDraft): string[] {
  const issues: string[] = []
  for (const row of draft.rows) {
    for (const issue of row.issues) {
      const label = row.symbol === '' ? '<no symbol>' : row.symbol
      issues.push(`${label}: ${issue}`)
    }
  }
  return issues
}

/** True when every row has a non-empty canonical symbol (blocking condition). */
export function draftHasRecognizableSymbols(draft: PortfolioImportDraft): boolean {
  return draft.rows.length > 0 && draft.rows.every((row) => row.symbol !== '')
}

/** The single currency when every row agrees on one; undefined otherwise. */
export function commonCurrency(rows: PortfolioImportRow[]): string | undefined {
  const currencies = [
    ...new Set(
      rows
        .map((row) => row.currency?.trim().toUpperCase())
        .filter((currency): currency is string => currency !== undefined && currency !== '')
    ),
  ]
  return currencies.length === 1 ? currencies[0] : undefined
}

/** Convert confirmed rows into account holdings (Holding shape). */
export function rowsToHoldings(rows: PortfolioImportRow[]): Holding[] {
  return rows
    .filter((row) => row.symbol !== '')
    .map((row) => ({
      symbol: row.symbol,
      name: row.name ?? '',
      ...(row.currency !== undefined ? { currency: row.currency } : {}),
      ...(row.quantity !== undefined ? { quantity: row.quantity } : {}),
      ...(row.costPrice !== undefined ? { costPrice: row.costPrice } : {}),
    }))
}

/** Build the persisted portfolio input from a confirmed draft. */
export function draftToPortfolioInput(
  draft: PortfolioImportDraft,
  name: string
): { name: string; currency?: string; holdings: Holding[] } {
  const holdings = rowsToHoldings(draft.rows)
  const currency = commonCurrency(draft.rows)
  return {
    name: name.trim() === '' ? 'Manual Portfolio' : name.trim(),
    ...(currency !== undefined ? { currency } : {}),
    holdings,
  }
}

/** Re-exported here so consumers import one module for draft handling. */
export type { ManualPortfolio, PortfolioImportDraft, PortfolioImportRow }
