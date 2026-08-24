import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { installHappyDom } from '../../test/setupHappyDom'
import { AgentAmbientField } from './AgentAmbientField'
import { SubtleDotField } from './SubtleDotField'

let restoreDom: (() => void) | undefined

beforeAll(() => {
  restoreDom = installHappyDom().restore
})

afterAll(() => {
  restoreDom?.()
})

async function render(element: React.ReactElement) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(element)
  })
  return { container, root }
}

describe('motion foundation', () => {
  it('maps agent states to a stable semantic field without animating idle or error', async () => {
    const { container: thinking } = await render(<AgentAmbientField state="thinking" particleCount={20} />)
    expect(thinking.querySelector('[data-testid="agent-ambient-field"]')?.getAttribute('data-motion-state')).toBe('thinking')
    expect(thinking.querySelectorAll('.folio-motion-ambient__particle')).toHaveLength(20)

    const { container: idle } = await render(<AgentAmbientField state="idle" />)
    expect(idle.querySelectorAll('.folio-motion-ambient__particle')).toHaveLength(0)

    const { container: error } = await render(<AgentAmbientField state="error" />)
    expect(error.querySelector('[data-testid="agent-ambient-field"]')?.getAttribute('data-motion-state')).toBe('error')
    expect(error.querySelectorAll('.folio-motion-ambient__particle')).toHaveLength(0)
  })

  it('keeps Discover scanning dots bounded and decorative', async () => {
    const { container } = await render(<SubtleDotField dotCount={100} />)
    const field = container.querySelector('[data-testid="subtle-dot-field"]')
    expect(field?.getAttribute('aria-hidden')).toBe('true')
    expect(field?.querySelectorAll('.folio-motion-dot-field__dot')).toHaveLength(48)
  })

  it('honors a reduced-motion media query without changing semantic state', async () => {
    const originalMatchMedia = window.matchMedia
    window.matchMedia = (() => ({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia

    const { container } = await render(<AgentAmbientField state="tool" particleCount={12} />)
    const field = container.querySelector('[data-testid="agent-ambient-field"]')
    expect(field?.getAttribute('data-reduced-motion')).toBe('true')
    expect(field?.getAttribute('data-motion-state')).toBe('tool')
    window.matchMedia = originalMatchMedia
  })
})
