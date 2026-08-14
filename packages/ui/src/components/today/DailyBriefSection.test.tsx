import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { AutomationRule } from '@finagent/core'
import { fallbackClient, FinagentClientProvider, type FinagentClient } from '../../client'
import type { DailyBrief } from '../../client/automation'
import { installHappyDom } from '../../test/setupHappyDom'
import { DailyBriefSection } from './DailyBriefSection'

let restoreDom: (() => void) | undefined

beforeAll(() => {
  restoreDom = installHappyDom().restore
})

afterAll(() => {
  restoreDom?.()
})

const BRIEF: DailyBrief = {
  generatedAt: 1_700_000_000_000,
  summary: '2 things need your attention.',
  items: [
    {
      id: 'watchlist-AAPL.US-mover',
      symbol: 'AAPL.US',
      title: 'AAPL.US moved +6.2%',
      message: 'Price move crossed the materiality bar vs previous close.',
      source: 'Watchlist',
      severity: 'warning',
      payload: { changePercent: 6.2 },
    },
    {
      id: 'alert-a1',
      symbol: 'NVDA.US',
      title: 'NVDA rating downgrade',
      message: 'Consensus rating moved from Buy to Hold.',
      source: 'Alert',
      severity: 'warning',
      payload: { ruleId: 'r1' },
    },
  ],
  quiet: { count: 3, message: '3 monitored securities: no material change' },
}

function clientWithBrief(brief: DailyBrief | null): FinagentClient {
  return {
    ...fallbackClient,
    automation: {
      listRules: async () => ({ ok: true, data: [] }),
      saveRule: async (rule: AutomationRule) => ({ ok: true, data: rule }),
      removeRule: async () => ({ ok: true, data: undefined }),
      runRule: async () => ({ ok: true, data: { id: 'r', ruleId: 'x', ranAt: 0, evaluated: 0, materialChanges: 0, analyzed: 0, notified: false, failures: [] } }),
      listRuns: async () => ({ ok: true, data: [] }),
      buildBrief: async () => (brief === null ? { ok: false, error: { code: 'NONE', message: 'missing' } } : { ok: true, data: brief }),
    },
  } as unknown as FinagentClient
}

async function flushAsync(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>()
      setTimeout(resolve, 0)
      await promise
    })
  }
}

function render(client: FinagentClient): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  return { container, root }
}

describe('DailyBriefSection', () => {
  it('renders items with source chips and the quiet line', async () => {
    const { container, root } = render(clientWithBrief(BRIEF))

    await act(async () => {
      root.render(
        <FinagentClientProvider client={clientWithBrief(BRIEF)}>
          <DailyBriefSection onManage={() => undefined} />
        </FinagentClientProvider>
      )
    })
    await flushAsync()

    const text = container.textContent ?? ''
    expect(text).toContain('Daily Brief')
    expect(text).toContain('2 things need your attention.')
    expect(text).toContain('AAPL.US moved +6.2%')
    expect(text).toContain('Watchlist')
    expect(text).toContain('Alert')
    expect(text).toContain('3 monitored securities: no material change')
    expect(text).not.toContain('undefined')

    await act(async () => {
      root.unmount()
    })
    container.remove()
  })

  it('expands "Why am I seeing this?" to reveal the payload', async () => {
    const { container, root } = render(clientWithBrief(BRIEF))

    await act(async () => {
      root.render(
        <FinagentClientProvider client={clientWithBrief(BRIEF)}>
          <DailyBriefSection onManage={() => undefined} />
        </FinagentClientProvider>
      )
    })
    await flushAsync()

    const whyButtons = Array.from(container.querySelectorAll('button')).filter((button) =>
      (button.textContent ?? '').includes('Why am I seeing this?')
    )
    expect(whyButtons.length).toBeGreaterThan(0)
    await act(async () => {
      whyButtons[0]?.click()
    })
    expect(container.textContent ?? '').toContain('"changePercent": 6.2')

    await act(async () => {
      root.unmount()
    })
    container.remove()
  })

  it('degrades to an empty state when the channel is missing', async () => {
    const { container, root } = render(fallbackClient)

    await act(async () => {
      root.render(
        <FinagentClientProvider client={fallbackClient}>
          <DailyBriefSection onManage={() => undefined} />
        </FinagentClientProvider>
      )
    })
    await flushAsync()

    const text = container.textContent ?? ''
    expect(text).toContain('Daily Brief')
    expect(text).toContain('Daily Brief is not available yet.')

    await act(async () => {
      root.unmount()
    })
    container.remove()
  })

  it('renders a brief without items as the quiet empty state', async () => {
    const quiet: DailyBrief = {
      generatedAt: 1_700_000_000_000,
      summary: 'Nothing needs your attention.',
      items: [],
      quiet: { count: 4, message: '4 monitored securities: no material change' },
    }
    const { container, root } = render(clientWithBrief(quiet))

    await act(async () => {
      root.render(
        <FinagentClientProvider client={clientWithBrief(quiet)}>
          <DailyBriefSection onManage={() => undefined} />
        </FinagentClientProvider>
      )
    })
    await flushAsync()

    const text = container.textContent ?? ''
    expect(text).toContain('4 monitored securities: no material change')
    expect(text).toContain('Nothing needs your attention.')

    await act(async () => {
      root.unmount()
    })
    container.remove()
  })
})
