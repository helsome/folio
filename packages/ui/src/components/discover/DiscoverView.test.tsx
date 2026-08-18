import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { getDefaultStore } from 'jotai'
import type { ApiResult, ScreeningRun } from '@finagent/core'
import { fallbackClient, FinagentClientProvider, type FinagentClient } from '../../client'
import { compareSymbolsAtom } from '../../atoms/compareAtoms'
import { activeSymbolAtom, navSectionAtom, watchlistAtom } from '../../atoms'
import { pendingResearchStrategyAtom } from '../../atoms/discoverAtoms'
import type { ScreeningChannel, ScreeningRunRequest } from '../../client/screening'
import { installHappyDom } from '../../test/setupHappyDom'
import { makeTestI18n, I18nextProvider } from '../../test/i18nTest'
import { DiscoverView } from './DiscoverView'

let restoreDom: (() => void) | undefined

beforeAll(() => {
  restoreDom = installHappyDom().restore
})

afterAll(() => {
  restoreDom?.()
})

const store = getDefaultStore()

beforeEach(() => {
  store.set(watchlistAtom, ['AAPL.US', 'TSLA.US', 'NVDA.US'])
  store.set(navSectionAtom, 'sessions')
  store.set(activeSymbolAtom, null)
  store.set(compareSymbolsAtom, [])
  store.set(pendingResearchStrategyAtom, null)
})

function deferred<T>() {
  return Promise.withResolvers<T>()
}

const RUN: ScreeningRun = {
  id: 'screen-strong-momentum-1',
  strategy: 'strong-momentum',
  query: { limit: 8 },
  providers: ['longbridge'],
  createdAt: 1_700_000_000_000,
  candidates: [
    {
      symbol: 'MSFT.US',
      name: 'Microsoft',
      score: 0.83,
      reasons: ['1m return +25.6%', '3m return +22.6%'],
      metrics: {},
      evidence: ['run-market-kline-1'],
    },
  ],
  failures: { 'market.sentiment': 'provider unavailable' },
}

function clientWithScreening(overrides?: Partial<ScreeningChannel>): FinagentClient {
  const screening: ScreeningChannel = {
    run: async () => ({ ok: true, data: RUN }),
    listRuns: async () => ({ ok: true, data: [RUN] }),
    getRun: async (input) => ({ ok: true, data: input.runId === RUN.id ? RUN : undefined }),
    ...overrides,
  }
  return { ...fallbackClient, screening } as FinagentClient
}

async function renderDiscoverView(client: FinagentClient) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <I18nextProvider i18n={makeTestI18n('en-US')}>
        <FinagentClientProvider client={client}>
          <DiscoverView />
        </FinagentClientProvider>
      </I18nextProvider>
    )
  })
  return { container, root }
}

async function renderDiscoverViewZh(client: FinagentClient) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <I18nextProvider i18n={makeTestI18n('zh-CN')}>
        <FinagentClientProvider client={client}>
          <DiscoverView />
        </FinagentClientProvider>
      </I18nextProvider>
    )
  })
  return { container, root }
}

async function flushAsync(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

function click(container: HTMLElement, testid: string): void {
  const element = container.querySelector<HTMLButtonElement>(`[data-testid="${testid}"]`)
  if (!element) throw new Error(`missing [data-testid="${testid}"]`)
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('DiscoverView', () => {
  it('renders the four task families with all 17 task cards', async () => {
    const { container } = await renderDiscoverView(clientWithScreening())

    for (const family of ['market-movers', 'fundamental', 'technical', 'events']) {
      expect(container.querySelector(`[data-testid="discover-family-${family}"]`)).not.toBeNull()
    }
    const runButtons = container.querySelectorAll('[data-testid^="discover-run-"]')
    expect(runButtons.length).toBe(17)
    expect(container.querySelector('[data-testid="discover-run-strong-momentum"]')?.textContent).toContain('Run')
    expect(container.querySelector('[data-testid="discover-history"]')).not.toBeNull()
  })

  it('runs a task with the watchlist universe, shows a per-task spinner, then candidates', async () => {
    const pending = deferred<ApiResult<ScreeningRun>>()
    const seenRequests: ScreeningRunRequest[] = []
    const client = clientWithScreening({
      run: async (input) => {
        seenRequests.push(input)
        return pending.promise
      },
      listRuns: async () => ({ ok: true, data: [] }),
    })
    const { container } = await renderDiscoverView(client)

    click(container, 'discover-run-strong-momentum')

    // In-flight: per-task spinner on the active card only.
    const active = container.querySelector('[data-testid="discover-run-strong-momentum"]')
    expect(active?.getAttribute('aria-busy')).toBe('true')
    expect(active?.textContent).toContain('Running')
    expect(active?.hasAttribute('disabled')).toBe(true)
    expect(container.querySelector('[data-testid="discover-run-top-gainers"]')?.hasAttribute('disabled')).toBe(true)

    await act(async () => {
      pending.resolve({ ok: true, data: RUN })
    })
    await flushAsync()

    expect(seenRequests).toEqual([
      {
        strategy: 'strong-momentum',
        universe: ['AAPL.US', 'TSLA.US', 'NVDA.US'],
        limit: 8,
      },
    ])
    const candidate = container.querySelector('[data-testid="candidate-MSFT.US"]')
    expect(candidate).not.toBeNull()
    expect(container.querySelector('[data-testid="candidate-score-MSFT.US"]')?.textContent).toBe('83')
    expect(candidate?.textContent).toContain('1m return +25.6%')
    // Honest failures are surfaced.
    expect(container.querySelector('[data-testid="discover-failures"]')?.textContent).toContain('market.sentiment')
  })

  it('Research action navigates with symbol + recommended strategy carried forward', async () => {
    const { container } = await renderDiscoverView(clientWithScreening())

    click(container, 'discover-run-strong-momentum')
    await flushAsync()
    click(container, 'candidate-research-MSFT.US')

    expect(store.get(activeSymbolAtom)).toBe('MSFT.US')
    expect(store.get(navSectionAtom)).toBe('research')
    // strong-momentum is a technical-family task → 'technical'.
    expect(store.get(pendingResearchStrategyAtom)).toBe('technical')
  })

  it('Compare action seeds the compare symbols and navigates', async () => {
    const { container } = await renderDiscoverView(clientWithScreening())

    click(container, 'discover-run-strong-momentum')
    await flushAsync()
    click(container, 'candidate-compare-MSFT.US')

    expect(store.get(compareSymbolsAtom)).toEqual(['MSFT.US'])
    expect(store.get(navSectionAtom)).toBe('compare')
  })

  it('Watch action adds the symbol to the watchlist', async () => {
    const { container } = await renderDiscoverView(clientWithScreening())

    click(container, 'discover-run-strong-momentum')
    await flushAsync()
    click(container, 'candidate-watch-MSFT.US')

    expect(store.get(watchlistAtom)).toContain('MSFT.US')
    expect(container.querySelector('[data-testid="candidate-watch-MSFT.US"]')?.textContent).toBe('Added')
  })

  it('previous-runs history lists runs and Reopen reloads candidates', async () => {
    const { container } = await renderDiscoverView(clientWithScreening())

    const row = container.querySelector('[data-testid^="discover-reopen-"]')
    expect(row).not.toBeNull()
    expect(container.textContent).toContain('Strong Momentum')

    click(container, `discover-reopen-${RUN.id}`)
    await flushAsync()

    expect(container.querySelector('[data-testid="candidate-MSFT.US"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="discover-results"]')?.textContent).toContain('1 candidate')
  })

  it('degrades gracefully when the screening channel is not wired', async () => {
    const { container } = await renderDiscoverView(fallbackClient)

    click(container, 'discover-run-strong-momentum')
    await flushAsync()

    expect(container.querySelector('[data-testid="discover-error"]')?.textContent).toContain('not wired')
    expect(container.querySelector('[data-testid="candidate-MSFT.US"]')).toBeNull()
    expect(container.textContent).toContain('No screening runs yet.')
  })

  it('renders translated Simplified Chinese labels and strategy titles in zh-CN', async () => {
    const { container } = await renderDiscoverViewZh(clientWithScreening())

    const text = container.textContent ?? ''
    expect(text).toContain('机会发现')
    expect(text).toContain('市场异动')
    expect(text).toContain('基本面')
    expect(text).toContain('涨幅居前')
    // A known strategy name renders in Chinese after a successful run.
    click(container, 'discover-run-strong-momentum')
    await flushAsync()
    expect(container.textContent).toContain('强势动能')
    // No raw keys or English chrome leak through.
    expect(text).not.toContain('discover.')
    expect(text).not.toContain('Strong Momentum')
  })
})
