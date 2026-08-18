/**
 * Locale resolution layer (V8 spec §17–18, §90).
 *
 * The *types* (`SupportedLocale`, `LocalePreference`) are domain contracts in
 * @finagent/core — this package owns the resolution logic and endonym labels.
 */
import {
  SUPPORTED_LOCALES as CORE_LOCALES,
  type LocalePreference,
  type SupportedLocale,
} from '@finagent/core';

export type { LocalePreference, SupportedLocale } from '@finagent/core';

/** Guard for untrusted IPC / storage values (repo rule: no `any`, type guards). */
export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === 'string' && CORE_LOCALES.includes(value as SupportedLocale);
}

/** Guard for untrusted preference values coming back from storage/IPC. */
export function isLocalePreference(value: unknown): value is LocalePreference {
  return value === 'system' || isSupportedLocale(value);
}

/**
 * Resolve a preference against an OS locale tag (e.g. `app.getLocale()` from
 * Electron, `navigator.language` in the browser).
 *
 * - pinned preference → that locale, verbatim
 * - `system` + a zh-* tag → `zh-CN`
 * - `system` + anything else (en, ja, fr…) → `en-US`
 *
 * First launch defaults to `'system'` so a Chinese OS boots straight into
 * Simplified Chinese and everything else into English (spec §18, §90).
 */
export function resolveLocale(preference: LocalePreference, systemLocale: string): SupportedLocale {
  if (preference !== 'system') {
    return isSupportedLocale(preference) ? preference : 'en-US';
  }
  const primary = String(systemLocale ?? '').toLowerCase().split('-')[0];
  const IS_ZH = new Set(['zh', 'zh-hans', 'zh-hant']);
  return IS_ZH.has(primary) ? 'zh-CN' : 'en-US';
}

/**
 * Human endonym for a locale, shown in the Language selector itself
 * (`简体中文` / `English`). Endonyms stay constant in either UI language and
 * are therefore not routed through translation resources.
 */
export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  'zh-CN': '简体中文',
  'en-US': 'English',
};

/** Narrow a raw OS/browser language tag down to a SupportedLocale (lenient). */
export function toSupportedLocale(systemLocale: string): SupportedLocale {
  return resolveLocale('system', systemLocale);
}
