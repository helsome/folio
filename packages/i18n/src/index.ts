/**
 * @finagent/i18n — Folio V8 internationalization kernel (spec §7).
 *
 * Renderer + Electron Main + tests share this one package so translations and
 * locale rules never drift. Feature agents import formatters and the locale
 * domain directly; React glue (`useTranslation`) lives in @finagent/ui.
 */
export type {
  SupportedLocale,
  LocalePreference,
} from './locales.ts';
export {
  LOCALE_LABELS,
  isSupportedLocale,
  isLocalePreference,
  resolveLocale,
  toSupportedLocale,
} from './locales.ts';

export {
  i18nSetCurrentLocale,
  i18nCurrentLocale,
  formatNumber,
  formatCompactNumber,
  formatCurrency,
  formatSignedCurrency,
  formatPercent,
  formatPercentRatio,
  formatDate,
  formatDateTime,
  formatMarketTime,
  formatRelativeTime,
} from './format.ts';

export {
  resources,
  SUPPORTED_NAMESPACES,
  SUPPORTED_LOCALES_FOR_RESOURCES,
  flattenLocale,
  interpolationVars,
  checkKeyParity,
  assertKeyParity,
  type LocaleParityIssue,
} from './resources.ts';

export { ERROR_CODE_TO_KEY, errorKeyForCode, translateErrorCode } from './error-messages.ts';
export type { SameKeysAs } from './locales/keys.ts';

export {
  createI18n,
  createSyncI18n,
  effectiveLocale,
  buildI18nOptions,
  type I18nOptions,
} from './i18n.ts';
export type { I18nInstance } from './i18n.ts';
