import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { NewsItem } from '@finagent/core'
import { createSyncI18n } from '@finagent/i18n'
import { I18nextProvider } from 'react-i18next'
import { getDefaultStore } from 'jotai'
import { activeSymbolAtom } from '../../atoms'
import { fallbackClient, FinagentClientProvider, type FinagentClient } from '../../client'
import { installHappyDom } from '../../test/setupHappyDom'
import { NewsView } from './NewsView'

let restoreDom: (() => void) | undefined

beforeAll(() => {
  restoreDom = installHappyDom().restore
})

afterAll(() => {
  restoreDom?.()
})

const store = getDefaultStore()
const i18n = createSyncI18n({ locale: 'en-US' })

/**
 * A news item whose `timestamp` is epoch SECONDS — the documented unit for
 * `NewsItem.timestamp` (packages/core/src/market-data.ts:10-11), and the unit
 * the capability layer itself converts from (`research-news.ts:40,57`).
 */
function newsItem(secondsAgo: number): NewsItem {
  return {
    id: 'n-1',
    title: 'Apple ships a thing',
    summary: 'A summary',
    url: 'https://example.com/n1',
    timestamp: Math.floor(Date.now() / 1000) - secondsAgo,
    symbols: ['AAPL.US'],
  }
}

async function flushAsync(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

async function renderNews(items: NewsItem[]) {
  store.set(activeSymbolAtom, 'AAPL.US')
  const client: FinagentClient = {
    ...fallbackClient,
    market: {
      ...fallbackClient.market,
      getNews: async () => ({ ok: true, data: items }),
    } as FinagentClient['market'],
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <I18nextProvider i18n={i18n}>
        <FinagentClientProvider client={client}>
          <NewsView />
        </FinagentClientProvider>
      </I18nextProvider>,
    )
  })
  await flushAsync()
  return { container, root }
}

describe('NewsView relative age', () => {
  it('ages a five-minute-old story in minutes, not years', async () => {
    const { container, root } = await renderNews([newsItem(5 * 60)])

    const text = container.textContent ?? ''
    expect(text).toContain('Apple ships a thing')
    expect(text).toContain('5m ago')

    await act(async () => root.unmount())
    container.remove()
  })

  it('ages a three-day-old story in days', async () => {
    const { container, root } = await renderNews([newsItem(3 * 86_400)])

    expect(container.textContent ?? '').toContain('3d ago')

    await act(async () => root.unmount())
    container.remove()
  })

  it('shows "just now" for a story dated slightly ahead of the clock', async () => {
    const { container, root } = await renderNews([newsItem(-30)])

    expect(container.textContent ?? '').toContain('just now')

    await act(async () => root.unmount())
    container.remove()
  })
})
