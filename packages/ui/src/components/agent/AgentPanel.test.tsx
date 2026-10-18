import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createStore, Provider } from 'jotai'
import type { Run } from '@finagent/core'
import { activeSessionIdAtom, navSectionAtom } from '../../atoms'
import { fallbackClient, FinagentClientProvider, type FinagentClient } from '../../client'
import { installHappyDom } from '../../test/setupHappyDom'
import { I18nextProvider, makeTestI18n } from '../../test/i18nTest'
import { AgentPanel } from './AgentPanel'

let restoreDom: (() => void) | undefined

beforeAll(() => {
  restoreDom = installHappyDom().restore
})

afterAll(() => {
  restoreDom?.()
})

const RUN: Run = {
  id: 'run-1',
  sessionId: 'session-1',
  status: 'running',
  startedAt: Date.now(),
} as Run

async function flushAsync(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

function makeClient(startRun: FinagentClient['kernel']['startRun']): FinagentClient {
  return {
    ...fallbackClient,
    kernel: { ...fallbackClient.kernel, startRun },
  }
}

async function renderPanel(client: FinagentClient) {
  const store = createStore()
  store.set(activeSessionIdAtom, 'session-1')
  store.set(navSectionAtom, 'research')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <Provider store={store}>
        <I18nextProvider i18n={makeTestI18n('en-US')}>
          <FinagentClientProvider client={client}>
            <AgentPanel />
          </FinagentClientProvider>
        </I18nextProvider>
      </Provider>
    )
  })
  await flushAsync()
  return { container, root, store }
}

async function cleanup(container: HTMLElement, root: ReturnType<typeof createRoot>) {
  await act(async () => root.unmount())
  container.remove()
}

function suggestionButtons(container: HTMLElement): HTMLButtonElement[] {
  const group = container.querySelector('[data-testid="agent-suggestions"]')
  return group ? Array.from(group.querySelectorAll('button')) : []
}

/**
 * #329: picking a suggestion used to call `setInput(text)` and then read
 * `input` from the same (stale) closure, so the run started with the previous
 * draft — or with an empty string. The send path now takes the picked text
 * explicitly.
 */
describe('AgentPanel suggestion chips', () => {
  it('sends the picked suggestion text — exactly once', async () => {
    const calls: Array<{ sessionId: string; content: string }> = []
    const client = makeClient(async (sessionId, content) => {
      calls.push({ sessionId, content })
      return { ok: true, data: RUN }
    })
    const { container, root } = await renderPanel(client)

    const chips = suggestionButtons(container)
    expect(chips.length).toBeGreaterThan(0)
    const picked = chips[0].textContent ?? ''
    expect(picked.length).toBeGreaterThan(0)

    await act(async () => chips[0].dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await flushAsync()

    expect(calls).toHaveLength(1)
    expect(calls[0].content).toBe(picked)
    expect(calls[0].sessionId).toBe('session-1')

    await cleanup(container, root)
  })

  it('never sends the composer content instead of the picked suggestion', async () => {
    const calls: string[] = []
    const client = makeClient(async (_sessionId, content) => {
      calls.push(content)
      return { ok: true, data: RUN }
    })
    const { container, root } = await renderPanel(client)

    const composer = container.querySelector<HTMLTextAreaElement>('[data-testid="agent-input"]')
    expect(composer).not.toBeNull()
    // The composer starts empty; the run must carry the chip text, never the
    // (stale) closure value of `input`.
    expect(composer?.value).toBe('')

    const chips = suggestionButtons(container)
    const picked = chips[0].textContent ?? ''
    await act(async () => chips[0].dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await flushAsync()

    expect(calls).toEqual([picked])
    expect(calls[0]).not.toBe('')
    // The suggestion path never owns the composer, so it stays untouched.
    expect(container.querySelector<HTMLTextAreaElement>('[data-testid="agent-input"]')?.value).toBe('')

    await cleanup(container, root)
  })

  it('does not start a second run while the first request is in flight', async () => {
    let resolveStart: ((value: { ok: true; data: Run }) => void) | undefined
    let calls = 0
    const client = makeClient(async () => {
      calls += 1
      return new Promise((resolve) => {
        resolveStart = resolve as (value: { ok: true; data: Run }) => void
      })
    })
    const { container, root } = await renderPanel(client)

    const chips = suggestionButtons(container)
    await act(async () => {
      chips[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
      chips[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flushAsync()
    expect(calls).toBe(1)

    await act(async () => resolveStart?.({ ok: true, data: RUN }))
    await flushAsync()

    await cleanup(container, root)
  })

  it('keeps the picked question in the composer when the run cannot start', async () => {
    const client = makeClient(async () => ({
      ok: false,
      error: { code: 'RUNTIME_DOWN', message: 'Runtime unavailable' },
    }))
    const { container, root } = await renderPanel(client)

    const chips = suggestionButtons(container)
    const picked = chips[0].textContent ?? ''
    await act(async () => chips[0].dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await flushAsync()

    expect(container.textContent).toContain('Runtime unavailable')
    const textarea = container.querySelector<HTMLTextAreaElement>('[data-testid="agent-input"]')
    expect((textarea as HTMLTextAreaElement).value).toBe(picked)

    await cleanup(container, root)
  })
})
