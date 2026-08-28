import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { fallbackClient, FinagentClientProvider, type FinagentClient } from '../../client'
import type { ConnectionEntry, HealthCheckReport } from '../../client/connections'
import { installHappyDom } from '../../test/setupHappyDom'
import { I18nextProvider, makeTestI18n } from '../../test/i18nTest'
import { ProfileSecurityView } from './ProfileSecurityView'

let restoreDom: (() => void) | undefined

beforeAll(() => {
  restoreDom = installHappyDom().restore
})

afterAll(() => {
  restoreDom?.()
})

const CONNECTION: ConnectionEntry = {
  providerId: 'longbridge',
  kind: 'broker-account',
  name: 'Longbridge',
  status: 'connected',
  health: null,
  coverage: null,
  configurable: false,
  configured: true,
  hasAccount: true,
  accountLabel: 'Demo account',
  error: null,
}

const HEALTH: HealthCheckReport = {
  ai: { ok: true, detail: 'ok', error: null },
  marketData: { ok: false, detail: 'offline', error: { code: 'OFFLINE', message: 'offline' } },
  skills: { ok: true, detail: 'ok', error: null },
  agentRuntime: { ok: true, detail: 'ok', error: null },
}

async function flushAsync(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

async function render(client: FinagentClient) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <I18nextProvider i18n={makeTestI18n('en-US')}>
        <FinagentClientProvider client={client}>
          <ProfileSecurityView />
        </FinagentClientProvider>
      </I18nextProvider>,
    )
  })
  return { container, root }
}

describe('ProfileSecurityView', () => {
  it('renders connection and health state from existing client channels', async () => {
    const client: FinagentClient = {
      ...fallbackClient,
      connections: { ...fallbackClient.connections!, list: async () => ({ ok: true, data: [CONNECTION] }) },
      health: { check: async () => ({ ok: true, data: HEALTH }) },
      about: { get: async () => ({ ok: true, data: { version: '1.2.3', channel: 'test', build: 'abc123' } }) },
    }
    const { container, root } = await render(client)
    await flushAsync()

    expect(container.querySelector('[data-testid="profile-view"]')).not.toBeNull()
    expect(container.textContent).toContain('Local Folio workspace')
    expect(container.textContent).toContain('Longbridge')
    expect(container.textContent).toContain('Demo account')
    expect(container.textContent).toContain('1.2.3')
    expect(container.textContent).toContain('Needs attention')

    await act(async () => root.unmount())
    container.remove()
  })

  it('shows unavailable states without fabricating identity data', async () => {
    const { container, root } = await render({ ...fallbackClient, connections: undefined, health: undefined })
    await flushAsync()

    expect(container.textContent).toContain('No connection entries are available')
    expect(container.textContent).toContain('—')
    expect(container.textContent).not.toContain('Alex')
    expect(container.textContent).not.toContain('alex@example.com')

    await act(async () => root.unmount())
    container.remove()
  })
})
