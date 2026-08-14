import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { AutomationRule, AutomationRun } from '@finagent/core'
import { fallbackClient, FinagentClientProvider, type FinagentClient } from '../../client'
import { installHappyDom } from '../../test/setupHappyDom'
import { AutomationRulesView } from './AutomationRulesView'

let restoreDom: (() => void) | undefined

beforeAll(() => {
  restoreDom = installHappyDom().restore
})

afterAll(() => {
  restoreDom?.()
})

const RULE: AutomationRule = {
  id: 'rule-1',
  type: 'watchlist-daily-review',
  enabled: true,
  notify: 'material-only',
  createdAt: 1_700_000_000_000,
}

const RUN: AutomationRun = {
  id: 'run-1',
  ruleId: 'rule-1',
  ranAt: 1_700_000_000_000,
  evaluated: 5,
  materialChanges: 1,
  analyzed: 1,
  notified: true,
  failures: [],
}

interface SaveRecord {
  rule: AutomationRule
  calls: number
}

function clientWithRules(options: { save?: (rule: AutomationRule) => void } = {}): {
  client: FinagentClient
  saveCalls: SaveRecord[]
  runRuleCalls: string[]
} {
  const saveCalls: SaveRecord[] = []
  const runRuleCalls: string[] = []
  const client: FinagentClient = {
    ...fallbackClient,
    automation: {
      listRules: async () => ({ ok: true, data: [RULE] }),
      saveRule: async (rule: AutomationRule) => {
        saveCalls.push({ rule, calls: saveCalls.length + 1 })
        options.save?.(rule)
        return { ok: true, data: rule }
      },
      removeRule: async () => ({ ok: true, data: undefined }),
      runRule: async (input: { ruleId: string }) => {
        runRuleCalls.push(input.ruleId)
        return { ok: true, data: RUN }
      },
      listRuns: async () => ({ ok: true, data: [RUN] }),
      buildBrief: async () => ({ ok: false, error: { code: 'NONE', message: 'missing' } }),
    },
  } as unknown as FinagentClient
  return { client, saveCalls, runRuleCalls }
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

describe('AutomationRulesView', () => {
  it('renders rule cards with schedule summary and notify mode', async () => {
    const { client } = clientWithRules()
    const { container, root } = render(client)

    await act(async () => {
      root.render(
        <FinagentClientProvider client={client}>
          <AutomationRulesView />
        </FinagentClientProvider>
      )
    })
    await flushAsync()

    const text = container.textContent ?? ''
    expect(text).toContain('Watchlist daily review')
    expect(text).toContain('Weekdays 16:30')
    expect(text).toContain('Material only')
    expect(text).toContain('Last run')
    expect(text).toContain('5 evaluated')

    await act(async () => {
      root.unmount()
    })
    container.remove()
  })

  it('toggle calls saveRule with the flipped rule', async () => {
    const { client, saveCalls } = clientWithRules()
    const { container, root } = render(client)

    await act(async () => {
      root.render(
        <FinagentClientProvider client={client}>
          <AutomationRulesView />
        </FinagentClientProvider>
      )
    })
    await flushAsync()

    const toggle = container.querySelector('[role="switch"]')
    expect(toggle).not.toBeNull()
    await act(async () => {
      ;(toggle as HTMLElement).click()
    })
    await flushAsync()

    expect(saveCalls).toHaveLength(1)
    expect(saveCalls[0]?.rule.id).toBe('rule-1')
    expect(saveCalls[0]?.rule.enabled).toBe(false)

    await act(async () => {
      root.unmount()
    })
    container.remove()
  })

  it('Run now calls runRule with the rule id', async () => {
    const { client, runRuleCalls } = clientWithRules()
    const { container, root } = render(client)

    await act(async () => {
      root.render(
        <FinagentClientProvider client={client}>
          <AutomationRulesView />
        </FinagentClientProvider>
      )
    })
    await flushAsync()

    const runButton = Array.from(container.querySelectorAll('button')).find((button) =>
      (button.textContent ?? '').includes('Run now')
    )
    expect(runButton).not.toBeUndefined()
    await act(async () => {
      runButton?.click()
    })
    await flushAsync()

    expect(runRuleCalls).toEqual(['rule-1'])

    await act(async () => {
      root.unmount()
    })
    container.remove()
  })

  it('shows an empty state when the channel is missing', async () => {
    const { container, root } = render(fallbackClient)

    await act(async () => {
      root.render(
        <FinagentClientProvider client={fallbackClient}>
          <AutomationRulesView />
        </FinagentClientProvider>
      )
    })
    await flushAsync()

    expect(container.textContent ?? '').toContain('No automation rules yet.')

    await act(async () => {
      root.unmount()
    })
    container.remove()
  })
})
