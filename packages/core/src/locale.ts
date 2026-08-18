/**
 * Locale domain types (V8 spec §6). Single source of truth in the shared/core
 * layer so every package (i18n, ui, electron, evaluation) speaks the same
 * language vocabulary. Resolution *logic* lives in @finagent/i18n.
 *
 * DISPLAY language must never alter business identity: tickers, capability
 * ids, skill ids, provider ids, metric ids, failure modes stay stable ASCII
 * identifiers — only their UI labels are localised.
 */

/** The only officially supported locales in V8 (spec §1). */
export type SupportedLocale = 'zh-CN' | 'en-US';

/**
 * User-facing preference: `'system'` follows the OS locale; anything else pins
 * the app to one supported locale (spec §14, §17).
 */
export type LocalePreference = 'system' | SupportedLocale;

export const SUPPORTED_LOCALES = ['zh-CN', 'en-US'] as const;

/** Storage shape: a `locale` field is set on first switch; absent = unset. */
export interface LocalePreferenceStorage {
  /** Defaults to `'system'` on first launch (spec §18). */
  locale?: LocalePreference;
}

/** Renderer-safe preference snapshot resolved against the OS locale (§16). */
export interface AppPreferencesSnapshot {
  preference: LocalePreference;
  /** OS/browser locale tag, e.g. `zh-CN` or `en-US`. */
  systemLocale: string;
  /** `resolveLocale(preference, systemLocale)` — the active UI locale. */
  effectiveLocale: SupportedLocale;
}
