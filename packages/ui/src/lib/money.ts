/**
 * Currency-aware money formatting (spec §17) — thin compatibility layer.
 *
 * Every formatter delegates to the @finagent/i18n formatters (spec §52-59)
 * so the active UI locale controls presentation (issue #86): the OS locale
 * no longer participates, and one view can never mix `US$1,234.56` and
 * `$1,234.56` for the same currency. Unknown currencies fall back to a
 * plain number + ISO code. NEVER hardcode `$`.
 */
import {
  formatCurrency,
  formatMarketTime,
  formatNumber,
  formatPercent as formatPercentI18n,
} from '@finagent/i18n'

const SUPPORTED_CURRENCIES: Record<string, true> = { USD: true, HKD: true, CNY: true, SGD: true }

/** Format a money value with its ISO currency; unknown code → plain number + code. */
export function formatMoney(value: number | undefined, currency?: string): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  const code = (currency ?? '').trim().toUpperCase()
  if (code !== '' && SUPPORTED_CURRENCIES[code] === true) {
    return formatCurrency(value, code)
  }
  const number = formatNumber(value, undefined, { maximumFractionDigits: 2 })
  return code !== '' ? `${number} ${code}` : number
}

/** Money with an explicit `+`/`−` sign for gains/losses. */
export function formatSignedMoney(value: number | undefined, currency?: string): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${formatMoney(value, currency)}`
}

/**
 * Percentage (already ×100) with sign; undefined → em dash. Same contract as
 * the i18n formatter: `23.5` → "+23.5%" (up to 2 fraction digits — trailing
 * zeros are not padded, matching the rest of the app's i18n output).
 */
export function formatPercent(value: number | undefined): string {
  return formatPercentI18n(value)
}

/** Share quantity as a grouped integer; undefined → em dash. */
export function formatQuantity(value: number | undefined): string {
  return formatNumber(value, undefined, { maximumFractionDigits: 0 })
}

/**
 * Data-source freshness line (spec §34): `Longbridge · Updated 10:42:03`
 * from `snapshot.fetchedAt`; `Updated time unknown` when there is no
 * timestamp.
 */
export function formatFreshness(provider: string, fetchedAt: number | undefined): string {
  if (fetchedAt === undefined || !Number.isFinite(fetchedAt) || fetchedAt <= 0) {
    return `${provider} · Updated time unknown`
  }
  return `${provider} · Updated ${formatMarketTime(fetchedAt)}`
}
