/**
 * Main-owned app preferences store (V8 spec §14–16).
 *
 * The locale preference lives in Electron-main-controlled userData via the
 * repo's atomic JsonFileStore, shared by renderer, agent runtime,
 * notifications, and dialogs. Persisted once, read on every boot — a set
 * locale survives restart without relying on web storage.
 */
import type { AppPreferencesSnapshot, LocalePreferenceStorage } from '@finagent/core';
import { isLocalePreference, resolveLocale, type LocalePreference } from '@finagent/i18n';
import { createCodeError } from '@finagent/shared';
import { JsonFileStore } from '@finagent/shared';

const FILE = 'app-preferences.json';

export interface AppPreferencesService {
  get: () => Promise<AppPreferencesSnapshot>;
  update: (locale: LocalePreference) => Promise<AppPreferencesSnapshot>;
}

export function createAppPreferencesService(
  store: JsonFileStore,
  getSystemLocale: () => string
): AppPreferencesService {
  async function readStored(): Promise<LocalePreferenceStorage> {
    const file = await store.read<LocalePreferenceStorage>(FILE, {});
    if (typeof file.locale !== 'string') return {};
    return isLocalePreference(file.locale) ? { locale: file.locale } : {};
  }

  function snapshot(pref: LocalePreferenceStorage): AppPreferencesSnapshot {
    const preference: LocalePreference =
      typeof pref.locale === 'string' && isLocalePreference(pref.locale) ? pref.locale : 'system';
    return {
      preference,
      systemLocale: getSystemLocale(),
      effectiveLocale: resolveLocale(preference, getSystemLocale()),
    };
  }

  return {
    async get() {
      return snapshot(await readStored());
    },
    async update(locale) {
      if (!isLocalePreference(locale)) {
        throw createCodeError('INVALID_ARGUMENT', 'Invalid locale preference.');
      }
      const next: LocalePreferenceStorage = { locale };
      await store.write(FILE, next);
      return snapshot(next);
    },
  };
}
