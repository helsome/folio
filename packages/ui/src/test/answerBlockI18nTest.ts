/**
 * Test-scoped i18next instance for typed answer block components (#31).
 * Registers only the `agent` namespace the block renderers read from,
 * following the isolation pattern of i18nTest.ts.
 */
import { createInstance, type i18n as I18nInstance } from 'i18next'
import { initReactI18next } from 'react-i18next'
import { agent as enAgent } from '../../../i18n/src/locales/en-US/agent'
import { agent as zhAgent } from '../../../i18n/src/locales/zh-CN/agent'
import { demo as enDemo } from '../../../i18n/src/locales/en-US/demo'
import { demo as zhDemo } from '../../../i18n/src/locales/zh-CN/demo'

const resources = {
  'en-US': { agent: enAgent, demo: enDemo },
  'zh-CN': { agent: zhAgent, demo: zhDemo },
}

/** Fresh, synchronously-initialised i18next instance for a given locale. */
export function makeAnswerBlockTestI18n(locale: 'en-US' | 'zh-CN'): I18nInstance {
  const instance = createInstance()
  instance.use(initReactI18next).init({
    resources,
    lng: locale,
    fallbackLng: 'en-US',
    supportedLngs: ['en-US', 'zh-CN'],
    defaultNS: 'agent',
    ns: ['agent', 'demo'],
    interpolation: { escapeValue: false },
    nsSeparator: '.',
    keySeparator: '.',
    returnEmptyString: false,
    initImmediate: false,
  })
  return instance
}
