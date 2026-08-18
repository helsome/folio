import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { common as enCommon } from '../../../i18n/src/locales/en-US/common.ts';
import { settings as enSettings } from '../../../i18n/src/locales/en-US/settings.ts';
import { connections as enConnections } from '../../../i18n/src/locales/en-US/connections.ts';
import { onboarding as enOnboarding } from '../../../i18n/src/locales/en-US/onboarding.ts';
import { diagnostics as enDiagnostics } from '../../../i18n/src/locales/en-US/diagnostics.ts';

/**
 * Register a global default i18next instance (en-US) for settings/onboarding
 * component tests that render under `useTranslation` without an
 * I18nextProvider. react-i18next falls back to this module-level default when
 * no provider is present, so `t('ns.key')` resolves to the real English
 * bundle instead of leaking keys. Scoped to this slice's namespaces to stay
 * isolated from other agents' in-flight resource work.
 *
 * Idempotent: only the first call initializes.
 */
let initialized = false;

export function initI18nForSettingsTests(): void {
  if (initialized) return;
  const instance = createInstance();
  instance.use(initReactI18next).init({
    resources: {
      'en-US': {
        common: enCommon,
        settings: enSettings,
        connections: enConnections,
        onboarding: enOnboarding,
        diagnostics: enDiagnostics,
      },
    },
    lng: 'en-US',
    fallbackLng: 'en-US',
    supportedLngs: ['en-US'],
    defaultNS: 'common',
    ns: ['common', 'settings', 'connections', 'onboarding', 'diagnostics'],
    interpolation: { escapeValue: false },
    nsSeparator: '.',
    keySeparator: '.',
    returnEmptyString: false,
    initImmediate: false,
  });
  initialized = true;
}
