import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider, createStore } from 'jotai'
import type { AlertTriggerEvent, PortfolioSnapshot, Quote } from '@finagent/core'
import {
  formatCurrency,
  formatShortDate,
  i18nCurrentLocale,
  i18nSetCurrentLocale,
  type SupportedLocale,
} from '@finagent/i18n'
import { fallbackClient, FinagentClientProvider, type FinagentClient } from '../../client'
import { installHappyDom } from '../../test/setupHappyDom'
import { makeTestI18n, I18nextProvider } from '../../test/i18nTest'
import { TodayView } from './TodayView'
import { portfolioCacheAtom } from '../../atoms/portfolioAtoms'

let restoreDom: (() => void) | undefined

beforeAll(() => {
  restoreDom = installHappyDom().restore
})

afterAll(() => {
  restoreDom?.()
})

const SNAPSHOT: PortfolioSnapshot = {
  baseCurrency: 'USD',
  totalAssets: 12345.67,
  marketValue: 12000,
  cash: 345.67,
  totalPnL: 234.56,
  todayPnL: -12.34,
  accounts: [],
  holdings: [],
  fetchedAt: Date.now(),
}

const CHANGE: Record<string, number> = {
  'AAPL.US': 2.5,
  'TSLA.US': -3.1,
  'NVDA.US': 1.2,
}

function makeQuote(symbol: string, changePercent: number): Quote {
  return {
    symbol,
    lastPrice: 100,
    change: 1,
    changePercent,
    volume: 1000,
    timestamp: Date.now(),
    high: 105,
    low: 95,
    open: 99,
    prevClose: 99,
  }
}

function clientWithPortfolio(): FinagentClient {
  return {
    ...fallbackClient,
    market: {
      ...fallbackClient.market,
      getPortfolio: async () => ({ ok: true, data: SNAPSHOT }),
      getQuote: async (symbol: string) => ({
        ok: true,
        data: makeQuote(symbol, CHANGE[symbol] ?? 0),
      }),
    },
    alerts: {
      loadRules: async () => ({ ok: true, data: [] }),
      saveRules: async () => ({ ok: true, data: undefined }),
      listEvents: async () => ({ ok: true, data: [] }),
      onTriggered: () => () => undefined,
    },
  }
}

async function flushAsync(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

describe('TodayView', () => {
  it.each(['en-US', 'zh-CN'] as const)('shows a portfolio fetch failure in %s without sample holdings', async (locale) => {
    const store = createStore()
    const client = clientWithPortfolio()
    client.market.getPortfolio = async () => ({
      ok: false, error: { code: 'LONGBRIDGE_TIMEOUT', message: 'raw timeout detail' },
    })
    const i18n = makeTestI18n(locale)
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    try {
      await act(async () => {
        root.render(
          <I18nextProvider i18n={i18n}>
            <Provider store={store}>
              <FinagentClientProvider client={client}><TodayView /></FinagentClientProvider>
            </Provider>
          </I18nextProvider>
        )
      })
      await flushAsync()
      expect(container.textContent).toContain(i18n.t('portfolio.failureDetail.timeout'))
      expect(container.textContent).not.toContain('raw timeout detail')
      expect(store.get(portfolioCacheAtom)).toMatchObject({ data: null, isDemo: false, failure: { kind: 'timeout' } })
    } finally {
      await act(async () => { root.unmount() })
      container.remove()
    }
  })

  it('renders portfolio + movers data without NaN/undefined', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <I18nextProvider i18n={makeTestI18n('en-US')}>
          <FinagentClientProvider client={clientWithPortfolio()}>
            <TodayView />
          </FinagentClientProvider>
        </I18nextProvider>
      )
    })
    await flushAsync()

    const text = container.textContent ?? ''
    expect(text).toContain('Today')
    expect(text).toContain('Portfolio')
    expect(text).toContain('Watchlist movers')
    // Real portfolio value renders through the currency formatter — the same
    // one the PortfolioCard uses (@finagent/i18n formatCurrency, locale
    // pinned to the i18n default). Comparing against lib/money's
    // system-locale formatMoney made this assertion host-dependent
    // ("US$12,345.67" on zh-CN Windows vs "$12,345.67" in the card).
    expect(text).toContain(formatCurrency(SNAPSHOT.totalAssets, SNAPSHOT.baseCurrency))
    // Top absolute mover (TSLA -3.1%) surfaces with its symbol.
    expect(text).toContain('TSLA.US')
    // Numerics are optional-domain values — nothing may render as JS garbage.
    expect(text).not.toContain('NaN')
    expect(text).not.toContain('undefined')
    expect(text).not.toContain('[object Object]')

    await act(async () => {
      root.unmount()
    })
    container.remove()
  })

  it('renders translated Simplified Chinese copy in zh-CN', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <I18nextProvider i18n={makeTestI18n('zh-CN')}>
          <FinagentClientProvider client={clientWithPortfolio()}>
            <TodayView />
          </FinagentClientProvider>
        </I18nextProvider>
      )
    })
    await flushAsync()

    const text = container.textContent ?? ''
    expect(text).toContain('早上好')
    expect(text).toContain('投资组合')
    expect(text).toContain('自选涨跌幅')
    expect(text).toContain('深度研究')
    // No English-only chrome leaks through in zh-CN.
    expect(text).not.toContain('Watchlist movers')
    expect(text).not.toContain('today.')

    await act(async () => {
      root.unmount()
    })
    container.remove()
  })

  it('formats alert times older than a day in the app locale, not the host locale', async () => {
    // 2024-11-21 is far outside the 24h relative-time window, so formatWhen
    // takes the short-date branch. Same guard style as the #293 locale policy:
    // pin the app locale to one whose output differs from the host OS, and
    // fail loudly if both supported locales would make the assertion vacuous.
    const ts = Date.UTC(2024, 10, 21, 9, 20, 0)
    const host = new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    const saved = i18nCurrentLocale()
    let locale: SupportedLocale | undefined
    let expected = ''
    for (const candidate of ['zh-CN', 'en-US'] as const) {
      i18nSetCurrentLocale(candidate)
      const formatted = formatShortDate(ts)
      if (formatted !== host) {
        locale = candidate
        expected = formatted
        break
      }
    }
    if (!locale) {
      i18nSetCurrentLocale(saved)
      throw new Error(
        `host locale renders ${JSON.stringify(host)} identically to both supported locales — the assertion would be vacuous`,
      )
    }
    expect(expected).not.toContain('2024')

    const store = createStore()
    const client = clientWithPortfolio()
    const event: AlertTriggerEvent = {
      id: 'evt-old',
      ruleId: 'rule-1',
      ruleType: 'price_above',
      symbol: 'NVDA.US',
      triggeredAt: ts,
      title: 'NVDA price alert',
      message: 'crossed the target',
    }
    if (client.alerts === undefined) throw new Error('test client is missing alerts')
    client.alerts.listEvents = async () => ({ ok: true, data: [event] })
    // makeTestI18n does not sync the formatter locale; formatWhen reads it.
    i18nSetCurrentLocale(locale)

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    try {
      await act(async () => {
        root.render(
          <I18nextProvider i18n={makeTestI18n(locale)}>
            <Provider store={store}>
              <FinagentClientProvider client={client}><TodayView /></FinagentClientProvider>
            </Provider>
          </I18nextProvider>
        )
      })
      await flushAsync()

      const item = Array.from(container.querySelectorAll('li')).find((li) =>
        li.textContent?.includes('NVDA price alert')
      )
      const when = item?.querySelector('span.tnum')
      expect(when?.textContent).toBe(expected)
      expect(when?.textContent).not.toBe(host)
      expect(when?.textContent ?? '').not.toContain('2024')
    } finally {
      i18nSetCurrentLocale(saved)
      await act(async () => { root.unmount() })
      container.remove()
    }
  })
})
