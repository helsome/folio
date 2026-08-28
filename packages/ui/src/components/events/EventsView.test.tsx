import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { CalendarEvent } from '@finagent/core'
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

describe('EventsView', () => {
  it('falls back to badged sample events when calendar capability is unavailable', async () => {
    const { container, root } = await render(fallbackClient)
    await flushAsync()

    expect(container.querySelector('[data-testid="events-view"]')).not.toBeNull()
    // Sample-data fallback: badge is rendered and demo events populate the list.
    expect(container.querySelector('[data-testid="demo-badge"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="events-list"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="events-list"]')?.textContent).toContain('AAPL.US')

    await act(async () => root.unmount())
    container.remove()
  })

  it('renders real calendar data without the sample badge', async () => {
    store.set(navSectionAtom, 'events')
    store.set(activeSymbolAtom, null)
    const client: FinagentClient = {
      ...fallbackClient,
      market: {
        ...fallbackClient.market,
        getCalendarEvents: async () => ({ ok: true, data: [EVENT] }),
      } as FinagentClient['market'],
    }
    const { container, root } = await render(client)
    await flushAsync()

    expect(container.querySelector('[data-testid="demo-badge"]')).toBeNull()
    expect(container.querySelector('[data-testid="events-list"]')?.textContent).toContain('AAPL.US')
    expect(container.textContent).toContain('Apple earnings')

    const researchButton = container.querySelector<HTMLButtonElement>('button[aria-label="Open research for AAPL.US"]')
    expect(researchButton).not.toBeNull()
    await act(async () => researchButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(store.get(activeSymbolAtom)).toBe('AAPL.US')
    expect(store.get(navSectionAtom)).toBe('research')

    await act(async () => root.unmount())
    container.remove()
  })

  it('falls back to badged sample events instead of inventing unlabeled data when the provider errors', async () => {
    const client: FinagentClient = {
      ...fallbackClient,
      market: {
        ...fallbackClient.market,
        getCalendarEvents: async () => ({ ok: false, error: { code: 'OFFLINE', message: 'Calendar offline' } }),
      } as FinagentClient['market'],
    }
    const { container, root } = await render(client)
    await flushAsync()

    // The error text is not surfaced as page state; the clearly-badged sample
    // list is rendered instead so the surface is never blank.
    expect(container.textContent).not.toContain('Calendar offline')
    expect(container.querySelector('[data-testid="demo-badge"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="events-list"]')).not.toBeNull()

    await act(async () => root.unmount())
    container.remove()
  })
})
