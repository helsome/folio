/**
 * Unified locale-aware formatters (spec §52–59).
 *
 * Every money/percent/date/relative-time value must render through this layer
 * so the UI locale controls presentation. Formatters take an optional explicit
 * locale; when omitted they fall back to the active UI locale (set by the
 * i18n root whenever the language changes).
 *
 * RULE: `Intl.NumberFormat` splits `style: 'percent'` by 100, so we NEVER hand
 * a `style:'percent'` formatter an already-×100 value. The ratio/percentage
 * convention:
 *   - `formatPercent(value)`   — `value` IS the percentage (23.5 → "23.5%")
 *   - `formatPercentRatio(r)`  — `r` is 0..1 (0.235 → "23.5%")
 * Current repo helpers (`formatPercent`) pass ×-100 values — keep that.
 */

import type { SupportedLocale } from './locales.ts';

const EN_US: SupportedLocale = 'en-US';
const DEFAULT_LOCALE: SupportedLocale = EN_US;

let currentLocale: SupportedLocale = DEFAULT_LOCALE;

/** Called by the i18n root whenever the effective language changes. */
export function i18nSetCurrentLocale(locale: SupportedLocale): void {
  currentLocale = locale;
}

/** Active UI locale used when a formatter receives no explicit locale. */
export function i18nCurrentLocale(): SupportedLocale {
  return currentLocale;
}

function localeOf(locale?: SupportedLocale): SupportedLocale {
  return locale ?? currentLocale;
}

/** Grouped number; undefined/NaN → em dash. */
export function formatNumber(
  value: number | undefined,
  locale?: SupportedLocale,
  options?: Intl.NumberFormatOptions
): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(localeOf(locale), {
    maximumFractionDigits: 2,
    ...options,
  }).format(value);
}

/** Locale-compact notation (en: 1.2B / zh: 12亿). Never hardcode K/M/B. */
export function formatCompactNumber(value: number | undefined, locale?: SupportedLocale): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(localeOf(locale), {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

/**
 * Money with its ISO currency code (USD/HKD/CNY…). Never hardcode `$`.
 * en-US: `$1,234.56` · zh-CN: `US$1,234.56` (Intl-standard).
 */
export function formatCurrency(
  value: number | undefined,
  currency?: string,
  locale?: SupportedLocale
): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  const code = (currency ?? '').trim().toUpperCase();
  if (code !== '') {
    try {
      return new Intl.NumberFormat(localeOf(locale), { style: 'currency', currency: code }).format(value);
    } catch {
      // Unknown/non-ISO currency code → grouped number + code.
    }
  }
  return `${new Intl.NumberFormat(localeOf(locale), { maximumFractionDigits: 2 }).format(value)}${code !== '' ? ` ${code}` : ''}`;
}

/** Money with explicit `+`/`−` sign for gains/losses. */
export function formatSignedCurrency(
  value: number | undefined,
  currency?: string,
  locale?: SupportedLocale
): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatCurrency(value, currency, locale)}`;
}

/**
 * Percentage with sign (value IS ×100, e.g. 23.5 → "+23.5%"). This is the
 * repo's existing call convention; see the ratio rule above.
 */
export function formatPercent(value: number | undefined, locale?: SupportedLocale): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${new Intl.NumberFormat(localeOf(locale), {
    style: 'percent',
    maximumFractionDigits: 2,
  }).format(value / 100)}`;
}

/** Ratio in 0..1 (0.235 → "23.5%"). See ratio rule above. */
export function formatPercentRatio(ratio: number | undefined, locale?: SupportedLocale): string {
  if (ratio === undefined || !Number.isFinite(ratio)) return '—';
  return new Intl.NumberFormat(localeOf(locale), {
    style: 'percent',
    maximumFractionDigits: 2,
  }).format(ratio);
}

/** Date only. en: `Aug 18, 2026` · zh: `2026年8月18日`. */
export function formatDate(ts: number | undefined, locale?: SupportedLocale): string {
  if (ts === undefined || !Number.isFinite(ts) || ts <= 0) return '—';
  return new Intl.DateTimeFormat(localeOf(locale), {
    year: 'numeric',
    month: localeOf(locale) === 'zh-CN' ? 'long' : 'short',
    day: 'numeric',
  }).format(ts);
}

/** Date + time. */
export function formatDateTime(ts: number | undefined, locale?: SupportedLocale): string {
  if (ts === undefined || !Number.isFinite(ts) || ts <= 0) return '—';
  return new Intl.DateTimeFormat(localeOf(locale), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(ts);
}

/** Clock time only (market-data freshness lines). */
export function formatMarketTime(ts: number | undefined, locale?: SupportedLocale): string {
  if (ts === undefined || !Number.isFinite(ts) || ts <= 0) return '—';
  return new Intl.DateTimeFormat(localeOf(locale), {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(ts);
}

/** Relative time (`8 seconds ago` / `8 秒前`) against `now` (default Date.now). */
export function formatRelativeTime(
  ts: number | undefined,
  now?: number,
  locale?: SupportedLocale
): string {
  if (ts === undefined || !Number.isFinite(ts) || ts <= 0) return '—';
  const base = now ?? Date.now();
  let delta = Math.round((ts - base) / 1000);
  const rtf = new Intl.RelativeTimeFormat(localeOf(locale), { numeric: 'auto' });
  const abs = Math.abs(delta);
  if (abs < 60) return rtf.format(delta, 'second');
  delta = Math.round(delta / 60);
  if (Math.abs(delta) < 60) return rtf.format(delta, 'minute');
  delta = Math.round(delta / 60);
  if (Math.abs(delta) < 24) return rtf.format(delta, 'hour');
  delta = Math.round(delta / 24);
  if (Math.abs(delta) < 30) return rtf.format(delta, 'day');
  delta = Math.round(delta / 30);
  if (Math.abs(delta) < 12) return rtf.format(delta, 'month');
  return rtf.format(Math.round(delta / 12), 'year');
}
