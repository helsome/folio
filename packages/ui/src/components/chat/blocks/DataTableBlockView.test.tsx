import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { DataTableBlock } from '@finagent/core'
import { I18nextProvider } from 'react-i18next'
import { makeTestI18n } from '../../../test/i18nTest'
import { installHappyDom } from '../../../test/setupHappyDom'
import { DataTableBlockView } from './DataTableBlockView'

let restoreDom: (() => void) | undefined

beforeAll(() => {
  restoreDom = installHappyDom().restore
})

afterAll(() => {
  restoreDom?.()
})

const i18n = makeTestI18n('en-US')

const COLUMNS: DataTableBlock['columns'] = [
  { key: 'symbol', label: 'Symbol' },
  { key: 'changePercent', label: 'Change', unit: 'percent' },
]

/** `rows` is typed `Record<string, string | number | null>` (core/src/answer-blocks.ts:65). */
function makeBlock(rows: DataTableBlock['rows']): DataTableBlock {
  return { type: 'data_table', version: 1, title: 'Movers', columns: COLUMNS, rows }
}

async function flushAsync(rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

/** The rendered text of one column, top to bottom. */
function column(container: HTMLElement, index: number): string[] {
  return Array.from(container.querySelectorAll('tbody tr')).map(
    (tr) => tr.querySelectorAll('td')[index]?.textContent ?? '',
  )
}

async function render(block: DataTableBlock) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <I18nextProvider i18n={i18n}>
        <DataTableBlockView block={block} />
      </I18nextProvider>,
    )
  })
  await flushAsync()
  return { container, root }
}

/** Header click cycles asc → desc → unsorted. */
async function clickHeader(container: HTMLElement, index: number): Promise<void> {
  const header = container.querySelectorAll('th')[index]
  await act(async () => {
    header?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await flushAsync()
}

/** Sort the missing row (changePercent = null, rendered as an em dash). */
const ROWS: DataTableBlock['rows'] = [
  { symbol: 'A', changePercent: 1 },
  { symbol: 'B', changePercent: 3 },
  { symbol: 'C', changePercent: null },
  { symbol: 'D', changePercent: 2 },
]

describe('DataTableBlockView sorting', () => {
  it('ascending puts the missing cell last', async () => {
    const { container, root } = await render(makeBlock(ROWS))

    await clickHeader(container, 1)
    expect(column(container, 0)).toEqual(['A', 'D', 'B', 'C'])

    await act(async () => root.unmount())
    container.remove()
  })

  it('descending keeps the missing cell last instead of moving it to the top', async () => {
    const { container, root } = await render(makeBlock(ROWS))

    await clickHeader(container, 1)
    await clickHeader(container, 1)
    expect(column(container, 0)).toEqual(['B', 'D', 'A', 'C'])

    await act(async () => root.unmount())
    container.remove()
  })

  it('descending keeps every missing cell at the bottom', async () => {
    const rows: DataTableBlock['rows'] = [
      { symbol: 'A', changePercent: 1 },
      { symbol: 'B', changePercent: null },
      { symbol: 'C', changePercent: 3 },
      { symbol: 'D', changePercent: null },
    ]
    const { container, root } = await render(makeBlock(rows))

    await clickHeader(container, 1)
    await clickHeader(container, 1)

    const changes = column(container, 1)
    expect(changes[0]).not.toBe('—')
    expect(changes[changes.length - 1]).toBe('—')

    await act(async () => root.unmount())
    container.remove()
  })
})
