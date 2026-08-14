/**
 * Currency-aware money formatting (spec §17). Every money value renders via
 * `Intl.NumberFormat` with the position/account currency; unknown currencies
 * fall back to a plain number + ISO code. NEVER hardcode `$`.
 */

const SUPPORTED_CURRENCIES: Record<string, true> = { USD: true, HKD: true, CNY: true, SGD: true }

/** Format a money value with its ISO currency; unknown code → plain number + code. */
export function formatMoney(value: number | undefined, currency?: string): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  const code = (currency ?? '').trim().toUpperCase()
  if (code !== '' && SUPPORTED_CURRENCIES[code] === true) {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(value)
  }
  const number = value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return code !== '' ? `${number} ${code}` : number
}

/** Money with an explicit `+`/`−` sign for gains/losses. */
export function formatSignedMoney(value: number | undefined, currency?: string): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${formatMoney(value, currency)}`
}

/** Percentage (already ×100) with sign; undefined → em dash. */
export function formatPercent(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

/** Share quantity as a grouped integer; undefined → em dash. */
export function formatQuantity(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)
}

/**
 * Data-source freshness line (spec §34): `Longbridge · Updated 10:42:13` from
 * `snapshot.fetchedAt`; `Updated time unknown` when there is no timestamp.
 */
export function formatFreshness(provider: string, fetchedAt: number | undefined): string {
  if (fetchedAt === undefined || !Number.isFinite(fetchedAt) || fetchedAt <= 0) {
    return `${provider} · Updated time unknown`
  }
  const time = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(fetchedAt)
  return `${provider} · Updated ${time}`
}
