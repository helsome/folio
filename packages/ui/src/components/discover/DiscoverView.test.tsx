import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { getDefaultStore } from 'jotai'
import type { ApiResult, ScreeningRun } from '@finagent/core'
import { fallbackClient, FinagentClientProvider, type FinagentClient } from '../../client'
import { compareSymbolsAtom } from '../../atoms/compareAtoms'
import { activeSymbolAtom, navSectionAtom, watchlistAtom } from '../../atoms'
import {
  pendingResearchStrategyAtom,
  screeningErrorAtom,
  screeningLastRunAtom,
  screeningResultsAtom,
  screeningRunsAtom,
  screeningRunningStrategyAtom,
} from '../../atoms/discoverAtoms'
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
  // Reset Discover run state so each test starts from Browse mode.
  store.set(screeningRunningStrategyAtom, null)
  store.set(screeningResultsAtom, null)
  store.set(screeningLastRunAtom, null)
  store.set(screeningErrorAtom, null)
  store.set(screeningRunsAtom, [])
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
      // Provider-grade raw values: long floats + mixed casing keys must never leak.
      metrics: {
        changePercent: 3.6824877250409163,
        lastPrice: 126.3699282931,
        pe: 24.6123,
        volume: 1200000,
      },
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

async function renderDiscoverView(client: FinagentClient, locale: 'en-US' | 'zh-CN' = 'en-US') {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <I18nextProvider i18n={makeTestI18n(locale)}>
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

  it('run → running → results → Back round-trips without the catalog above results', async () => {
    const pending = deferred<ApiResult<ScreeningRun>>()
    const client = clientWithScreening({ run: async () => pending.promise })
    const { container } = await renderDiscoverView(client)

    // Browse: catalog present.
    expect(container.querySelector('[data-testid="discover-family-fundamental"]')).not.toBeNull()

    click(container, 'discover-run-strong-momentum')

    // Running: dedicated view at top of viewport — catalog NOT above it.
    expect(container.querySelector('[data-testid="discover-running"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="discover-family-fundamental"]')).toBeNull()
    expect(container.querySelector('[data-testid="discover-back"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="discover-running-skeleton"]')).not.toBeNull()

    await act(async () => {
      pending.resolve({ ok: true, data: RUN })
    })
    await flushAsync()

    // Results: dedicated result view, no catalog above.
    expect(container.querySelector('[data-testid="discover-results"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="discover-family-fundamental"]')).toBeNull()
    expect(container.querySelector('[data-testid="candidate-MSFT.US"]')).not.toBeNull()

    // Back → browse.
    click(container, 'discover-back')
    await flushAsync()
    expect(container.querySelector('[data-testid="discover-family-fundamental"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="candidate-MSFT.US"]')).toBeNull()
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

    // Running switches the catalog out for the dedicated running view — no
    // per-task button remains in the DOM.
    expect(container.querySelector('[data-testid="discover-run-strong-momentum"]')).toBeNull()
    expect(container.querySelector('[data-testid="discover-running"]')).not.toBeNull()

    await act(async () => {
      pending.resolve({ ok: true, data: RUN })
    })
    await flushAsync()

    expect(seenRequests).toEqual([
      { strategy: 'strong-momentum', universe: ['AAPL.US', 'TSLA.US', 'NVDA.US'], limit: 8 },
    ])
    const candidate = container.querySelector('[data-testid="candidate-MSFT.US"]')
    expect(candidate).not.toBeNull()
    expect(candidate?.textContent).toContain('1m return +25.6%')
  })

  it('formats metrics through the presentation layer — no raw keys, no long floats', async () => {
    const { container } = await renderDiscoverView(clientWithScreening())

    click(container, 'discover-run-strong-momentum')
    await flushAsync()

    const candidateText = container.querySelector('[data-testid="candidate-MSFT.US"]')?.textContent ?? ''
    // Formatted values, not provider raw numbers.
    expect(container.querySelector('[data-testid="candidate-score-MSFT.US"]')?.textContent).toBe('83')
    expect(container.querySelector('[data-testid="candidate-price-MSFT.US"]')?.textContent).toBe('126.37')
    expect(container.querySelector('[data-testid="candidate-change-MSFT.US"]')?.textContent).toBe('+3.68%')
    // Extra canonical metrics render as subtle product-labeled text.
    expect(candidateText).toContain('PE 24.61×')
    expect(candidateText).toContain('1.2M')
    // Raw provider keys / raw floats never leak.
    expect(candidateText).not.toContain('CHANGEPERCENT')
    expect(candidateText).not.toContain('LASTPRICE')
    expect(candidateText).not.toContain('changePercent')
    expect(candidateText).not.toContain('3.6824877250409163')
    expect(candidateText).not.toContain('126.3699282931')
  })

  it('shows a human-readable provider warning with a connections link, not the raw error', async () => {
    const { container } = await renderDiscoverView(clientWithScreening())

    click(container, 'discover-run-strong-momentum')
    await flushAsync()

    const warning = container.querySelector('[data-testid="discover-provider-warning"]')
    expect(warning).not.toBeNull()
    expect(warning?.textContent).toContain('Some market data may be unavailable')
    expect(container.querySelector('[data-testid="discover-goto-connections"]')?.textContent).toContain('Go to connection settings')
    // Raw provider error lives only in the advanced details, not main copy.
    expect(warning?.textContent).toContain('market.sentiment')
    // Partial-data banner when failures coexist with candidates.
    expect(container.querySelector('[data-testid="discover-failures"]')?.textContent).toContain('Partial data')
  })

  it('Research action navigates with symbol + recommended strategy carried forward', async () => {
    const { container } = await renderDiscoverView(clientWithScreening())

    click(container, 'discover-run-strong-momentum')
    await flushAsync()
    click(container, 'candidate-research-MSFT.US')

    expect(store.get(activeSymbolAtom)).toBe('MSFT.US')
    expect(store.get(navSectionAtom)).toBe('research')
    expect(store.get(pendingResearchStrategyAtom)).toBe('technical')
  })

  it('Compare / Watch live in the More menu and navigate / persist to the watchlist', async () => {
    const { container } = await renderDiscoverView(clientWithScreening())

    click(container, 'discover-run-strong-momentum')
    await flushAsync()

    // Compare through the More menu.
    click(container, 'candidate-more-MSFT.US')
    click(container, 'candidate-compare-MSFT.US')
    expect(store.get(compareSymbolsAtom)).toEqual(['MSFT.US'])
    expect(store.get(navSectionAtom)).toBe('compare')
  })

  it('Watch writes to the real watchlist atom and the card reflects it', async () => {
    store.set(watchlistAtom, ['AAPL.US', 'TSLA.US'])
    const { container } = await renderDiscoverView(clientWithScreening())

    click(container, 'discover-run-strong-momentum')
    await flushAsync()

    // MSFT.US not yet watched → menu item is "Watch".
    click(container, 'candidate-more-MSFT.US')
    expect(container.querySelector('[data-testid="candidate-watch-MSFT.US"]')?.textContent).toBe('Watch')
    click(container, 'candidate-watch-MSFT.US')

    // Written to the real atom, not component-local state.
    expect(store.get(watchlistAtom)).toContain('MSFT.US')

    // Re-opening the menu reflects the live watchlist state (now Added).
    click(container, 'candidate-more-MSFT.US')
    expect(container.querySelector('[data-testid="candidate-watch-MSFT.US"]')?.textContent).toBe('Added')
  })

  it('history reopen lands directly in results mode, not back at the catalog', async () => {
    const { container } = await renderDiscoverView(clientWithScreening())

    // Browse history has a reopen entry.
    const row = container.querySelector('[data-testid^="discover-reopen-"]')
    expect(row).not.toBeNull()
    expect(container.textContent).toContain('Strong Momentum')

    click(container, `discover-reopen-${RUN.id}`)
    await flushAsync()

    // Opened directly into results — catalog gone, results visible.
    expect(container.querySelector('[data-testid="candidate-MSFT.US"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="discover-family-fundamental"]')).toBeNull()
    expect(container.querySelector('[data-testid="discover-results"]')?.textContent).toContain('1 candidate')
  })

  it('shows an empty-state with guidance when a run yields no candidates', async () => {
    const emptyRun: ScreeningRun = { ...RUN, candidates: [], failures: {} }
    const client = clientWithScreening({ run: async () => ({ ok: true, data: emptyRun }) })
    const { container } = await renderDiscoverView(client)

    click(container, 'discover-run-strong-momentum')
    await flushAsync()

    const empty = container.querySelector('[data-testid="discover-empty"]')
    expect(empty).not.toBeNull()
    expect(empty?.textContent).toContain('No candidates matched')
    expect(empty?.textContent).toContain('Add more watchlist symbols')
    // No provider warning when there are no failures.
    expect(container.querySelector('[data-testid="discover-provider-warning"]')).toBeNull()
  })

  it('degrades gracefully when the screening channel is not wired', async () => {
    const { container } = await renderDiscoverView(fallbackClient)

    click(container, 'discover-run-strong-momentum')
    await flushAsync()

    expect(container.querySelector('[data-testid="discover-error"]')?.textContent).toContain('not wired')
    expect(container.querySelector('[data-testid="candidate-MSFT.US"]')).toBeNull()
    expect(container.textContent).toContain('No screening runs yet.')
  })

  it('renders translated Simplified Chinese labels, metrics and strategy titles in zh-CN', async () => {
    const { container } = await renderDiscoverView(clientWithScreening(), 'zh-CN')

    const text = container.textContent ?? ''
    expect(text).toContain('机会发现')
    expect(text).toContain('市场异动')
    expect(text).toContain('基本面')
    expect(text).toContain('涨幅居前')
    // No raw keys leak in browse.
    expect(text).not.toContain('discover.')
    expect(text).not.toContain('Strong Momentum')

    click(container, 'discover-run-strong-momentum')
    await flushAsync()

    const resultText = container.querySelector('[data-testid="discover-results"]')?.textContent ?? ''
    expect(resultText).toContain('强势动能')
    // Formatted metrics in Chinese product labels, no raw keys/floats.
    expect(resultText).toContain('市盈率 24.61×')
    expect(resultText).not.toContain('CHANGEPERCENT')
    expect(resultText).not.toContain('LASTPRICE')
    expect(resultText).not.toContain('3.6824877250409163')
    expect(container.querySelector('[data-testid="discover-provider-warning"]')?.textContent).toContain('部分行情数据可能不可用')
    expect(container.querySelector('[data-testid="discover-goto-connections"]')?.textContent).toContain('前往连接设置')
  })
})
