import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { PerformanceHorizon, SkillPerformance, StrategyPerformance } from '@finagent/core'
import { installHappyDom } from '../../test/setupHappyDom'
import { PerformanceCard, type PerformanceRowView } from './PerformanceCard'
import { PerformanceView } from './PerformanceView'

let restoreDom: (() => void) | undefined

beforeAll(() => {
  restoreDom = installHappyDom().restore
})

afterAll(() => {
  restoreDom?.()
})

function renderText(element: React.ReactElement): string {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(element)
  })
  return container.textContent ?? ''
}

async function flushAsync(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

function installPerformanceApi(
  skills: SkillPerformance[],
  strategies: StrategyPerformance[]
): void {
  ;(window as { electronAPI?: unknown }).electronAPI = {
    performance: {
      skill: async ({ horizon }: { horizon: PerformanceHorizon }) => ({
        ok: true,
        data: skills.filter((s) => s.horizon === horizon),
      }),
      strategy: async ({ horizon }: { horizon: PerformanceHorizon }) => ({
        ok: true,
        data: strategies.filter((s) => s.horizon === horizon),
      }),
    },
  }
}

describe('PerformanceCard', () => {
  it('shows the Observational Only badge and em dashes for missing metrics', () => {
    const rows: PerformanceRowView[] = [
      {
        id: 's1',
        label: 'Skill One',
        samples: 5,
        hitRate: undefined,
        metric: undefined,
        unableRate: 0.2,
        insufficientData: true,
      },
    ]
    const text = renderText(
      <PerformanceCard
        title="Skill Performance"
        metricLabel="Avg Return"
        rows={rows}
        emptyMessage="No evaluated skill outcomes yet."
      />
    )
    expect(text).toContain('Skill One')
    expect(text).toContain('5')
    expect(text).toContain('Observational Only')
    // Never a fabricated '0%' — missing metrics render '—' (a zero render
    // would show as '0.00%').
    expect(text).not.toContain('0.00%')
    expect(text).toContain('—')
  })

  it('renders numbers for a sufficient group without the badge', () => {
    const rows: PerformanceRowView[] = [
      {
        id: 's2',
        label: 'Skill Two',
        samples: 40,
        hitRate: 0.65,
        metric: 2.4,
        unableRate: 0.05,
        insufficientData: false,
      },
    ]
    const text = renderText(
      <PerformanceCard
        title="Skill Performance"
        metricLabel="Avg Return"
        rows={rows}
        emptyMessage="empty"
      />
    )
    expect(text).toContain('65.0%')
    expect(text).toContain('+2.40%')
    expect(text).toContain('5.0%')
    expect(text).not.toContain('Observational Only')
  })

  it('shows the empty message when there are no rows', () => {
    const text = renderText(
      <PerformanceCard
        title="Strategy Performance"
        metricLabel="Median Excess Return"
        rows={[]}
        emptyMessage="No evaluated strategy outcomes yet."
      />
    )
    expect(text).toContain('No evaluated strategy outcomes yet.')
  })
})

describe('PerformanceView', () => {
  it('renders both cards, horizon tabs and empty states without a wired channel', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(<PerformanceView />)
    })
    await flushAsync()

    const text = container.textContent ?? ''
    expect(text).toContain('Skill Performance')
    expect(text).toContain('Strategy Performance')
    expect(text).toContain('1 Week')
    expect(text).toContain('1 Month')
    expect(text).toContain('3 Months')
    expect(text).toContain('No evaluated skill outcomes yet.')
    expect(text).toContain('No evaluated strategy outcomes yet.')
  })

  it('renders aggregated rows from the performance channel (Observational Only + em dash)', async () => {
    installPerformanceApi(
      [
        {
          skillId: 'longbridge-value-investing',
          horizon: '1m',
          samples: 5,
          directionHitRate: 0.8,
          avgReturn: undefined,
          unableRate: 0.1,
          insufficientData: true,
        },
      ],
      [
        {
          strategyId: 'value',
          horizon: '1m',
          samples: 40,
          hitRate: 0.7,
          medianExcessReturn: 1.5,
          insufficientData: false,
        },
      ]
    )
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(<PerformanceView />)
    })
    await flushAsync()

    const text = container.textContent ?? ''
    expect(text).toContain('Longbridge Value Investing')
    expect(text).toContain('Value')
    expect(text).toContain('80.0%')
    expect(text).toContain('Observational Only')
    // avgReturn is undefined for the skill row → em dash, never '0.00%'.
    expect(text).not.toContain('0.00%')
    expect(text).toContain('—')
    expect(text).toContain('+1.50%')
  })
})
