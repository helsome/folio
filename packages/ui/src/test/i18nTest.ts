/**
 * Test-scoped i18next instance for the App shell / Today / Discover /
 * Command palette slices.
 *
 * Imports the namespace resource files directly (not the @finagent/i18n
 * bundle) so these tests stay isolated from other agents' in-flight namespace
 * work and from any unrelated registration that is mid-edit.
 */
import { createInstance, type i18n as I18nInstance } from 'i18next'
import { initReactI18next, I18nextProvider } from 'react-i18next'
import { common as enCommon } from '../../../i18n/src/locales/en-US/common'
import { navigation as enNavigation } from '../../../i18n/src/locales/en-US/navigation'
import { today as enToday } from '../../../i18n/src/locales/en-US/today'
import { discover as enDiscover } from '../../../i18n/src/locales/en-US/discover'
import { portfolio as enPortfolio } from '../../../i18n/src/locales/en-US/portfolio'
import { common as zhCommon } from '../../../i18n/src/locales/zh-CN/common'
import { navigation as zhNavigation } from '../../../i18n/src/locales/zh-CN/navigation'
import { today as zhToday } from '../../../i18n/src/locales/zh-CN/today'
import { discover as zhDiscover } from '../../../i18n/src/locales/zh-CN/discover'
import { portfolio as zhPortfolio } from '../../../i18n/src/locales/zh-CN/portfolio'

const NAMESPACES = ['common', 'navigation', 'today', 'discover', 'portfolio'] as const

const resources = {
  'en-US': {
    common: enCommon,
    navigation: enNavigation,
    today: enToday,
    discover: enDiscover,
    portfolio: enPortfolio,
  },
  'zh-CN': {
    common: zhCommon,
    navigation: zhNavigation,
    today: zhToday,
    discover: zhDiscover,
    portfolio: zhPortfolio,
  },
}

/** Fresh, synchronously-initialised i18next instance for a given locale. */
export function makeTestI18n(locale: 'en-US' | 'zh-CN'): I18nInstance {
  const instance = createInstance()
  instance.use(initReactI18next).init({
    resources,
    lng: locale,
    fallbackLng: 'en-US',
    supportedLngs: ['en-US', 'zh-CN'],
    defaultNS: 'common',
    ns: [...NAMESPACES],
    interpolation: { escapeValue: false },
    nsSeparator: '.',
    keySeparator: '.',
    returnEmptyString: false,
    initImmediate: false,
  })
  return instance
}

export { I18nextProvider }
