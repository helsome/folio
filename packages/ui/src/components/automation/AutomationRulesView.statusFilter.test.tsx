import { afterAll, beforeAll, expect, it } from 'bun:test'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { AutomationRule } from '@finagent/core'
import { createSyncI18n } from '@finagent/i18n'
import { fallbackClient, FinagentClientProvider, type FinagentClient } from '../../client'
import { installHappyDom } from '../../test/setupHappyDom'
import { withI18n } from '../../test/i18n'
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

function clientWithRules(): FinagentClient {
  return {
    ...fallbackClient,
    automation: {
      listRules: async () => ({ ok: true, data: [RULE] }),
      saveRule: async (rule: AutomationRule) => ({ ok: true, data: rule }),
      removeRule: async () => ({ ok: true, data: undefined }),
      runRule: async () => ({ ok: false, error: { code: 'NONE', message: 'missing' } }),
      listRuns: async () => ({ ok: true, data: [] }),
      buildBrief: async () => ({ ok: false, error: { code: 'NONE', message: 'missing' } }),
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

/**
 * The status filter offers "all | active | paused". The two narrower options
 * already use the locale layer (`automation.status.active` /
 * `automation.status.paused`) while the first one was a literal `All`, so a
 * zh-CN user saw a mixed-language dropdown. `common.all` already exists.
 */
it('renders the status filter "all" option from the shared locale key', async () => {
  const zh = createSyncI18n({ locale: 'zh-CN' })
  const expected = zh.t('common.all')
  // Pin the resource so this assertion cannot silently pass if the key moves.
  expect(expected).toBe('全部')

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)

  await act(async () => {
    root.render(
      withI18n(
        <FinagentClientProvider client={clientWithRules()}>
          <AutomationRulesView />
        </FinagentClientProvider>,
        'zh-CN'
      )
    )
  })
  await flushAsync()

  try {
    const option = container.querySelector('select option[value="all"]')
    expect(option?.textContent).toBe(expected)
  } finally {
    await act(async () => {
      root.unmount()
    })
    container.remove()
  }
})
