import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { PortfolioSnapshot, Quote } from '@finagent/core'
import { fallbackClient, FinagentClientProvider, type FinagentClient } from '../../client'
import { installHappyDom } from '../../test/setupHappyDom'
import { formatMoney } from '../../lib/money'
import { makeTestI18n, I18nextProvider } from '../../test/i18nTest'
import { TodayView } from './TodayView'

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
    // Real portfolio value renders through the currency formatter.
    expect(text).toContain(formatMoney(SNAPSHOT.totalAssets, SNAPSHOT.baseCurrency))
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
})
