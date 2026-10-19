import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { installHappyDom } from '../../test/setupHappyDom'
import { makeTestI18n, I18nextProvider } from '../../test/i18nTest'
import { WatchlistHeatmap } from './WatchlistHeatmap'

let restoreDom: (() => void) | undefined

beforeAll(() => {
  restoreDom = installHappyDom().restore
})

afterAll(() => {
  restoreDom?.()
})

describe('WatchlistHeatmap', () => {
  it('shows unavailable values explicitly and opens research for the selected symbol', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onSelect = (symbol: string): void => {
      container.dataset.selectedSymbol = symbol
    }

    await act(async () => {
      root.render(
        <I18nextProvider i18n={makeTestI18n('en-US')}>
          <WatchlistHeatmap
            items={[
              { symbol: 'AAPL.US', changePercent: 2.5, fetchedAt: Date.now(), isDemo: false, providerName: 'Yahoo Finance', delayed: true },
              { symbol: 'MSFT.US', changePercent: null, fetchedAt: null, isDemo: false },
            ]}
            onSelect={onSelect}
          />
        </I18nextProvider>
      )
    })

    const unavailable = container.querySelector('[data-testid="heatmap-tile-MSFT.US"]')
    expect(unavailable?.getAttribute('aria-label')).toContain('Unavailable')
    const apple = container.querySelector('[data-testid="heatmap-tile-AAPL.US"]')
    expect(apple?.getAttribute('aria-label')).toContain('Yahoo Finance')
    expect(apple?.getAttribute('aria-label')).toContain('delayed')
    expect(apple?.textContent).toContain('Yahoo Finance')
    expect(apple?.textContent).toContain('delayed')
    expect(container.textContent).toContain('Industry data is not available')

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="heatmap-tile-AAPL.US"]')?.click()
    })
    expect(container.dataset.selectedSymbol).toBe('AAPL.US')

    await act(async () => root.unmount())
    container.remove()
  })
})
