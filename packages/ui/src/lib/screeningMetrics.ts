import type { SupportedLocale } from '@finagent/i18n'
import { formatCompactNumber, formatNumber, formatPercent } from '@finagent/i18n'

/**
 * Screening metric presentation layer (spec §11–16).
 *
 * Raw provider keys (changePercent / change_percent / CHANGEPERCENT …) are
 * canonicalised here into stable product fields once, so no UI ever has to
 * switch on 8 casing variants or call `String(number)` on a 15-digit float.
 * Unknown metrics and non-finite values never leak — they are hidden or
 * rendered as an em dash by the underlying formatters.
 */

export type ScreeningMetricKind = 'price' | 'percent' | 'ratio' | 'compact'

export interface ScreeningMetricSpec {
  /** i18n label key under `discover.metric.*` (product-visible name). */
  labelKey: string
  kind: ScreeningMetricKind
}

/** Canonical product fields, keyed by the normalised metric name. */
export const SCREENING_METRIC_DISPLAY = {
  changePercent: { labelKey: 'change', kind: 'percent' },
  lastPrice: { labelKey: 'price', kind: 'price' },
  volume: { labelKey: 'volume', kind: 'compact' },
  pe: { labelKey: 'pe', kind: 'ratio' },
  pb: { labelKey: 'pb', kind: 'ratio' },
  roe: { labelKey: 'roe', kind: 'percent' },
  dividendYield: { labelKey: 'dividendYield', kind: 'percent' },
  revenueGrowth: { labelKey: 'revenueGrowth', kind: 'percent' },
  momentum: { labelKey: 'momentum', kind: 'percent' },
} as const satisfies Record<string, ScreeningMetricSpec>

export type ScreeningMetricKey = keyof typeof SCREENING_METRIC_DISPLAY

/**
 * Raw key → canonical product key. Aliases are normalised to lowercase; both
 * snake_case (`change_percent`) and UPPER_CASE (`CHANGEPERCENT`) collapse to
 * the same product field. The engine also emits `dpsRate` for dividend yield.
 */
const KEY_ALIASES: Record<string, ScreeningMetricKey> = {
  changepercent: 'changePercent',
  change_percent: 'changePercent',
  lastprice: 'lastPrice',
  last_price: 'lastPrice',
  volume: 'volume',
  pe: 'pe',
  p_e: 'pe',
  'p/e': 'pe',
  pb: 'pb',
  p_b: 'pb',
  'p/b': 'pb',
  roe: 'roe',
  dividendyield: 'dividendYield',
  dividend_yield: 'dividendYield',
  dpsrate: 'dividendYield',
  revenuegrowth: 'revenueGrowth',
  revenue_growth: 'revenueGrowth',
  momentum: 'momentum',
}

/** Map any raw provider key to its canonical product key, else undefined. */
export function normalizeMetricKey(raw: string): ScreeningMetricKey | undefined {
  if (typeof raw !== 'string') return undefined
  return KEY_ALIASES[raw.trim().toLowerCase()]
}

/** Coerce a metric value to a finite number, else undefined (no NaN/Infinity). */
function toFinite(value: string | number | undefined): number | undefined {
  if (value === undefined || value === null) return undefined
  const num = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(num) ? num : undefined
}

/**
 * Format one raw metric for display. Returns `null` for unknown keys and
 * non-finite (undefined / NaN / Infinity) values so the caller can hide them.
 */
export function formatScreeningMetric(
  key: string,
  value: string | number | undefined,
  locale?: SupportedLocale
): { key: ScreeningMetricKey; text: string } | null {
  const canonical = normalizeMetricKey(key)
  if (!canonical) return null
  const num = toFinite(value)
  if (num === undefined) return null
  const spec = SCREENING_METRIC_DISPLAY[canonical]
  let text: string
  switch (spec.kind) {
    case 'price':
      // Price: 2 decimals, grouping intact.
      text = formatNumber(num, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      break
    case 'percent':
      // Percent: 1–2 decimals with sign (e.g. +3.7%). value is already ×100.
      text = formatPercent(num, locale)
      break
    case 'ratio':
      // Ratio / multiple: 1–2 decimals with a × suffix (e.g. 24.6×).
      text = `${formatNumber(num, locale)}×`
      break
    case 'compact':
      // Large counts: locale-compact notation (en 1.2M / zh 120万).
      text = formatCompactNumber(num, locale)
      break
  }
  return { key: canonical, text }
}

/**
 * Collect the canonical metrics present on a candidate, in a stable order,
 * with every value already formatted. Unknown / non-finite metrics are
 * dropped so raw provider keys and 15-digit floats never surface.
 */
export function orderedMetricRenders(
  metrics: Record<string, string | number | undefined>,
  locale?: SupportedLocale
): Array<{ key: ScreeningMetricKey; text: string }> {
  const out: Array<{ key: ScreeningMetricKey; text: string }> = []
  for (const [rawKey, value] of Object.entries(metrics)) {
    const render = formatScreeningMetric(rawKey, value, locale)
    if (render) out.push(render)
  }
  return out
}
