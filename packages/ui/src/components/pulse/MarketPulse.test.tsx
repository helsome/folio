import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { ScreeningCandidate } from '@finagent/core'
import { fallbackClient, FinagentClientProvider, type FinagentClient } from '../../client'
import { partitionPulseMovers, type MarketPulseSnapshot } from '../../client/pulse'
import { installHappyDom } from '../../test/setupHappyDom'
import { MarketPulse } from './MarketPulse'

let restoreDom: (() => void) | undefined
let container: HTMLElement
let root: ReturnType<typeof createRoot>

beforeAll(() => {
  restoreDom = installHappyDom().restore
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterAll(() => {
  root?.unmount()
  container?.remove()
  restoreDom?.()
})

function mover(symbol: string, changePercent: number): ScreeningCandidate {
  return {
    symbol,
    name: symbol,
    score: 0.5,
    reasons: [],
    metrics: { changePercent, lastPrice: 100 },
    evidence: [],
  }
}

const SNAPSHOT: MarketPulseSnapshot = {
  indices: [
    { symbol: 'SPX.US', name: 'S&P 500', lastPrice: 5100.5, changePercent: 0.5 },
    { symbol: 'NDX.US', name: 'Nasdaq 100', lastPrice: 18100, changePercent: -0.3 },
  ],
  marketStatus: [{ market: 'US', status: 'Open' }],
  temperature: { score: 62, label: 'Warm', market: 'US' },
  movers: [
    mover('AAPL.US', 6.2),
    mover('NVDA.US', 4.1),
    mover('MSFT.US', -3.4),
    mover('TSLA.US', -2.2),
  ],
  personalImpact: {
    scope: 'watchlist',
    items: [
      {
        symbol: 'AAPL.US',
        changePercent: 6.2,
        watchlistExposurePercent: 33.33,
        portfolioExposurePercent: 15,
        impact: 'positive',
      },
      {
        symbol: 'TSLA.US',
        changePercent: -2.2,
        watchlistExposurePercent: 33.33,
        impact: 'negative',
      },
    ],
  },
  failures: [],
  generatedAt: Date.now(),
}

function clientWithPulse(snapshot: MarketPulseSnapshot | null): FinagentClient {
  return {
    ...fallbackClient,
    pulse: {
      snapshot: async () => ({ ok: true, data: snapshot }),
    },
  } as unknown as FinagentClient
}

async function renderPulse(client: FinagentClient): Promise<void> {
  root = createRoot(container)
  await act(async () => {
    root.render(
      <FinagentClientProvider client={client}>
        <MarketPulse />
      </FinagentClientProvider>
    )
  })
  // flush the mount effect's async snapshot load
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

describe('partitionPulseMovers', () => {
  it('splits gainers from losers and drops zero-change candidates', () => {
    const { gainers, losers } = partitionPulseMovers([
      mover('AAPL.US', 6.2),
      mover('MSFT.US', -3.4),
      mover('C.US', 0),
    ])
    expect(gainers.map((m) => m.symbol)).toEqual(['AAPL.US'])
    expect(losers.map((m) => m.symbol)).toEqual(['MSFT.US'])
  })

  it('is empty-safe', () => {
    const { gainers, losers } = partitionPulseMovers([])
    expect(gainers).toEqual([])
    expect(losers).toEqual([])
  })
})

describe('MarketPulse', () => {
  it('renders every section with real data', async () => {
    await renderPulse(clientWithPulse(SNAPSHOT))
    const text = container.textContent ?? ''

    // indices line
    expect(text).toContain('S&P 500')
    expect(text).toContain('SPX.US')
    expect(text).toContain('+0.50%')
    expect(text).toContain('-0.30%')
    // market status + temperature
    expect(text).toContain('US · Open')
    expect(text).toContain('62/100')
    expect(text).toContain('Warm')
    // top movers columns
    expect(text).toContain('Top gainers')
    expect(text).toContain('Top losers')
    expect(text).toContain('+6.20%')
    expect(text).toContain('-3.40%')
    // personal impact
    expect(text).toContain('What matters to me')
    expect(text).toContain('33.3%')
    expect(text).toContain('Positive')
    expect(text).toContain('Negative')

    expect(container.querySelectorAll('[data-testid="pulse-index"]').length).toBe(2)
    expect(container.querySelectorAll('[data-testid="pulse-mover-row"]').length).toBe(4)
    expect(container.querySelectorAll('[data-testid="pulse-impact-row"]').length).toBe(2)
    expect(container.querySelector('[data-testid="pulse-failures-note"]')).toBeNull()
  })

  it('renders honest empty states when the snapshot is empty', async () => {
    await renderPulse(
      clientWithPulse({
        indices: [],
        marketStatus: [],
        temperature: null,
        movers: [],
        personalImpact: null,
        failures: ['market.quote unavailable'],
        generatedAt: Date.now(),
      })
    )
    const text = container.textContent ?? ''

    expect(text).toContain('Index quotes unavailable')
    expect(text).toContain('Market status unavailable')
    expect(text).toContain('Market temperature unavailable')
    expect(text).toContain('No movers')
    expect(text).toContain('No movers in your watchlist')
    expect(container.querySelector('[data-testid="pulse-failures-note"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-testid="pulse-mover-row"]').length).toBe(0)
  })

  it('renders empty states when the pulse channel is missing (pre-wiring)', async () => {
    await renderPulse(fallbackClient)
    const text = container.textContent ?? ''
    expect(text).toContain('Index quotes unavailable')
    expect(text).toContain('No movers in your watchlist')
    expect(container.querySelectorAll('[data-testid="pulse-mover-row"]').length).toBe(0)
  })
})
