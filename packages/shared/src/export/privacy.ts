import type { ResearchReport } from '@finagent/core'

/**
 * Privacy hardening for share/export (spec §55).
 *
 * Research reports carry only report content — symbol, stance, sections,
 * evidence refs — never portfolio size, positions, account balances or other
 * user-account data. `redactForShare` is the defensive backstop anyway: any
 * field whose key looks account/position-like AND whose value is numeric (or
 * numeric-looking) is dropped before a report reaches a share renderer, so a
 * future report payload that accidentally embeds such data cannot leak
 * through Markdown or the share card. Prose, evidence claims and all other
 * report content pass through untouched.
 */

/** Key shapes that may carry account/position/portfolio data. */
export const ACCOUNT_LIKE_KEY =
  /(account|position|portfolio|holding|balance|equity|assets|netasset|net_asset|nav)/i

const NUMERIC_STRING = /^-?\d+(\.\d+)?$/

function isNumeric(value: unknown): boolean {
  return typeof value === 'number' || (typeof value === 'string' && NUMERIC_STRING.test(value))
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (ACCOUNT_LIKE_KEY.test(key) && isNumeric(child)) continue
      out[key] = redact(child)
    }
    return out
  }
  return value
}

/** Deep copy of `report` with account-like numeric fields stripped. */
export function redactForShare(report: ResearchReport): ResearchReport {
  return redact(report) as unknown as ResearchReport
}
