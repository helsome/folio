/**
 * V8 i18n React glue (spec §19–20, §22, §88–89).
 *
 * Owns a single renderer i18next instance wired to the main-owned locale
 * preference (`client.prefs`). Switching language:
 *   1. persists the preference via IPC (main writes userData),
 *   2. `changeLanguage` on the i18next instance → react-i18next re-renders the
 *      whole tree (no restart),
 *   3. `document.documentElement.lang` is updated for a11y/typography.
 */
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { createInstance, type i18n as I18nInstance, type TFunction } from 'i18next';
import {
  LOCALE_LABELS,
  buildI18nOptions,
  i18nSetCurrentLocale,
  toSupportedLocale,
  isSupportedLocale,
  type LocalePreference,
  type SupportedLocale,
} from '@finagent/i18n';
import type { AppPreferencesSnapshot } from '@finagent/core';
import { useFinagentClient } from '../client';

/** Build the renderer-level i18next instance (plugin wired before init). */
function createRendererI18n(): I18nInstance {
  const instance = createInstance();
  instance.use(initReactI18next).init(buildI18nOptions({ locale: 'en-US' }));
  i18nSetCurrentLocale('en-US');
  instance.on('languageChanged', (lng: string) => {
    i18nSetCurrentLocale(toSupportedLocale(lng));
  });
  return instance;
}

export interface I18nContextValue {
  /** Current preference (system | zh-CN | en-US). */
  preference: LocalePreference;
  /** OS/browser locale tag. */
  systemLocale: string;
  /** Active effective UI locale. */
  locale: SupportedLocale;
  /** Endonym label for the active locale (LOCALE_LABELS). */
  localeLabel: string;
  ready: boolean;
  /** `t` bound to the current instance (rich-context fallback). */
  t: TFunction;
  /** Persist + apply a new preference (instant, no restart). */
  changeLanguage: (preference: LocalePreference) => Promise<AppPreferencesSnapshot>;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const client = useFinagentClient();
  const instanceRef = useRef<I18nInstance | null>(null);
  const [snapshot, setSnapshot] = useState<AppPreferencesSnapshot | null>(null);

  // Initialise the renderer i18next instance once (fallback en-US until the
  // main-owned snapshot arrives, preventing a raw-key flash).
  if (instanceRef.current === null) {
    instanceRef.current = createRendererI18n();
  }
  const instance = instanceRef.current;

  // Load the persisted preference from main on mount (or fall back to browser).
  useEffect(() => {
    let mounted = true;
    const boot = async () => {
      const result = client.prefs
        ? await client.prefs.get()
        : await Promise.resolve(undefined);
      let snap: AppPreferencesSnapshot | null = null;
      if (result && result.ok) {
        snap = result.data;
      } else if (typeof navigator !== 'undefined') {
        snap = {
          preference: 'system',
          systemLocale: navigator.language,
          effectiveLocale: isSupportedLocale(navigator.language)
            ? navigator.language
            : (navigator.language?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'),
        };
      }
      if (!snap) return;
      if (mounted) {
        setSnapshot(snap);
        await instance.changeLanguage(snap.effectiveLocale);
      }
    };
    void boot();
    return () => {
      mounted = false;
    };
  }, [client, instance]);

  // Keep <html lang> in sync with the active locale (spec §20).
  useEffect(() => {
    if (snapshot) {
      document.documentElement.lang = snapshot.effectiveLocale;
    }
  }, [snapshot]);

  const value = useMemo<I18nContextValue>(() => {
    const pref = snapshot?.preference ?? 'system';
    const locale = (snapshot?.effectiveLocale ?? 'en-US');
    return {
      preference: pref,
      systemLocale: snapshot?.systemLocale ?? (typeof navigator !== 'undefined' ? navigator.language : 'en-US'),
      locale,
      localeLabel: LOCALE_LABELS[locale],
      ready: snapshot !== null,
      t: instance.t.bind(instance),
      changeLanguage: async (preference: LocalePreference) => {
        const result = client.prefs ? await client.prefs.update(preference) : null;
        const snap: AppPreferencesSnapshot =
          result && result.ok ? result.data : { preference, systemLocale: navigator.language, effectiveLocale: locale };
        setSnapshot(snap);
        await instance.changeLanguage(snap.effectiveLocale);
        return snap;
      },
    };
    // client is stable per provider; instance is stable.
  }, [client, instance, snapshot]);

  return (
    <I18nextProvider i18n={instance}>
      <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
    </I18nextProvider>
  );
}

/** Read the active locale context from anywhere under I18nProvider. */
export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (ctx === null) {
    throw new Error('useI18n must be used within <I18nProvider>.');
  }
  return ctx;
}
