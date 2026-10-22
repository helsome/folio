import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { ApiResult, CalendarEvent } from '@finagent/core'
import { getDefaultStore } from 'jotai'
import { activeSymbolAtom, navSectionAtom } from '../../atoms'
import { fallbackClient, FinagentClientProvider, type FinagentClient } from '../../client'
import { installHappyDom } from '../../test/setupHappyDom'
import { I18nextProvider, makeTestI18n } from '../../test/i18nTest'
import { EventsView } from './EventsView'

let restoreDom: (() => void) | undefined

beforeAll(() => {
  restoreDom = installHappyDom().restore
})

afterAll(() => {
  restoreDom?.()
})

const store = getDefaultStore()

const EVENT: CalendarEvent = {
  id: 'earnings-aapl',
  date: Math.floor(Date.now() / 1000) + 3600,
  type: 'earnings',
  activityType: 'quarterly-report',
  symbol: 'AAPL.US',
  name: 'Apple earnings',
  content: 'Quarterly results',
  localDate: 'Tomorrow',
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
          <EventsView />
        </FinagentClientProvider>
      </I18nextProvider>,
    )
  })
  return { container, root }
}

async function unmount(container: HTMLElement, root: ReturnType<typeof createRoot>) {
  await act(async () => root.unmount())
  container.remove()
}

type CalendarFetch = (input: { eventType?: string; symbols?: string[] }) => Promise<ApiResult<CalendarEvent[]>>

function clientWith(getCalendarEvents: CalendarFetch): FinagentClient {
  return {
    ...fallbackClient,
    market: {
      ...fallbackClient.market,
      getCalendarEvents,
    } as unknown as FinagentClient['market'],
  }
}

describe('EventsView', () => {
  it('renders real calendar data without the sample badge', async () => {
    store.set(navSectionAtom, 'events')
    store.set(activeSymbolAtom, null)
    const { container, root } = await render(clientWith(async () => ({ ok: true, data: [EVENT] })))
    await flushAsync()

    expect(container.querySelector('[data-testid="demo-badge"]')).toBeNull()
    expect(container.querySelector('[data-testid="events-list"]')?.textContent).toContain('AAPL.US')
    expect(container.textContent).toContain('Apple earnings')
    expect(container.querySelector('[data-testid="events-empty"]')).toBeNull()

    const researchButton = container.querySelector<HTMLButtonElement>('button[aria-label="Open research for AAPL.US"]')
    expect(researchButton).not.toBeNull()
    await act(async () => researchButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(store.get(activeSymbolAtom)).toBe('AAPL.US')
    expect(store.get(navSectionAtom)).toBe('research')

    await unmount(container, root)
  })

  /**
   * #330: a successful empty response is an answer about the user's calendar —
   * it must not be replaced by invented events.
   */
  it('shows an honest empty state for a successful empty result', async () => {
    const { container, root } = await render(clientWith(async () => ({ ok: true, data: [] })))
    await flushAsync()

    expect(container.querySelector('[data-testid="events-empty"]')?.textContent).toContain(
      'No events in the selected range.'
    )
    expect(container.querySelector('[data-testid="events-list"]')).toBeNull()
    expect(container.querySelector('[data-testid="demo-badge"]')).toBeNull()

    await unmount(container, root)
  })

  it('renders sample events only after the explicit sample toggle', async () => {
    const { container, root } = await render(clientWith(async () => ({ ok: true, data: [] })))
    await flushAsync()

    const toggle = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('View sample events')
    )
    expect(toggle).not.toBeNull()
    await act(async () => toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await flushAsync()

    expect(container.querySelector('[data-testid="demo-badge"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="events-sample-note"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="events-list"]')?.textContent).toContain('AAPL.US')
    // Sample rows carry no research hand-off: they are not real event context.
    expect(container.querySelector('button[aria-label="Open research for AAPL.US"]')).toBeNull()

    await unmount(container, root)
  })

  it('surfaces a provider error with a retry entry instead of sample events', async () => {
    let calls = 0
    const client = clientWith(async () => {
      calls += 1
      return { ok: false, error: { code: 'OFFLINE', message: 'Calendar offline' } }
    })
    const { container, root } = await render(client)
    await flushAsync()

    expect(container.querySelector('[data-testid="events-error"]')?.textContent).toContain(
      'Upcoming events are unavailable'
    )
    expect(container.querySelector('[data-testid="events-list"]')).toBeNull()
    expect(container.querySelector('[data-testid="demo-badge"]')).toBeNull()

    const retry = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Retry')
    )
    expect(retry).not.toBeNull()
    await act(async () => retry?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await flushAsync()
    expect(calls).toBe(2)

    await unmount(container, root)
  })

  it('surfaces a thrown exception as an error, not as sample events', async () => {
    const client = clientWith(async () => {
      throw new Error('ipc closed')
    })
    const { container, root } = await render(client)
    await flushAsync()

    expect(container.querySelector('[data-testid="events-error"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="events-list"]')).toBeNull()

    await unmount(container, root)
  })

  it('explains the missing channel instead of inventing events', async () => {
    const { container, root } = await render(fallbackClient)
    await flushAsync()

    expect(container.querySelector('[data-testid="events-unavailable"]')?.textContent).toContain(
      'No market calendar is connected yet'
    )
    expect(container.querySelector('[data-testid="events-list"]')).toBeNull()
    expect(container.querySelector('[data-testid="demo-badge"]')).toBeNull()

    await unmount(container, root)
  })
})
