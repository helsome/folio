/**
 * i18next instance factories (spec §4–5, §19, §82).
 *
 * One translate engine, reused by renderer (react-i18next), Electron Main, and
 * tests. Resources are bundled local JSON — fully offline, no CDN/SaaS.
 *
 * Missing-key behavior: dev/test logs a console warning; production falls back
 * to en-US so a raw key never leaks to the user (spec §82).
 */
import { createInstance, type i18n as I18nInstance, type InitOptions } from 'i18next';
import { resolveLocale, toSupportedLocale, type LocalePreference, type SupportedLocale } from './locales.ts';
import { i18nSetCurrentLocale } from './format.ts';
import { resources, SUPPORTED_NAMESPACES } from './resources.ts';

function isDevelopment(): boolean {
  if (typeof process === 'undefined') return false;
  return process.env.NODE_ENV !== 'production';
}

export interface I18nOptions {
  /** Effective UI locale (already resolved against system). */
  locale: SupportedLocale;
}

export function buildI18nOptions(opts: I18nOptions): InitOptions {
  return {
    resources,
    lng: opts.locale,
    fallbackLng: 'en-US',
    supportedLngs: ['en-US', 'zh-CN'],
    defaultNS: 'common',
    ns: [...SUPPORTED_NAMESPACES],
    interpolation: { escapeValue: false },
    // Dotted keys (`portfolio.totalAssets`) per spec §9 — dot is the namespace
    // separator, not i18next's v21+ default `:`. Guards against later refactors
    // silently switching to a different separator convention.
    nsSeparator: '.',
    keySeparator: '.',
    returnEmptyString: false,
    initImmediate: false,
    missingKeyHandler: isDevelopment()
      ? (lngs, ns, key) => {
          // eslint-disable-next-line no-console
          console.warn(`[i18n] missing key ${ns}:${key} (${lngs.join(',')})`);
        }
      : undefined,
  };
}

function attachFormatterSync(instance: I18nInstance): I18nInstance {
  instance.on('languageChanged', (lng: string) => {
    i18nSetCurrentLocale(toSupportedLocale(lng));
  });
  // Sync current locale to mark initial state.
  i18nSetCurrentLocale(toSupportedLocale(instance.language ?? 'en-US'));
  return instance;
}

/**
 * Fresh i18next instance — safe for renderer root, Electron Main, and tests
 * (no shared mutable global). Callers own explicit instances.
 */
export function createI18n(opts: I18nOptions): I18nInstance {
  const instance = createInstance();
  void instance.init(buildI18nOptions(opts));
  return attachFormatterSync(instance);
}

/** Synchronously-initialised instance (Electron Main startup, spec §78). */
export function createSyncI18n(opts: I18nOptions): I18nInstance {
  const instance = createInstance();
  instance.init(buildI18nOptions(opts));
  return attachFormatterSync(instance);
}

/** Resolve a stored preference against a system locale, honoring `system`. */
export function effectiveLocale(preference: LocalePreference, systemLocale: string): SupportedLocale {
  return resolveLocale(preference, systemLocale);
}

/** Narrow an i18next language back to a SupportedLocale. */
export { toSupportedLocale };

export type { I18nInstance };
export type { SupportedLocale, LocalePreference };
