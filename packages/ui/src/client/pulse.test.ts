import { describe, expect, it } from 'bun:test'
import type { ScreeningCandidate } from '@finagent/core'
import { fallbackClient, type FinagentClient } from '../client'
import { loadPulseSnapshot, partitionPulseMovers, type MarketPulseSnapshot, type PulseSnapshotInput } from './pulse'

function mover(symbol: string, changePercent: number): ScreeningCandidate {
  return {
    symbol,
    name: symbol,
    score: 0.5,
    reasons: [],
    metrics: { changePercent, lastPrice: 100 },
    evidence: [],
  }
}

const SNAPSHOT: MarketPulseSnapshot = {
  indices: [],
  marketStatus: null,
  temperature: null,
  movers: [mover('AAPL.US', 6.2)],
  personalImpact: null,
  failures: [],
  generatedAt: 1,
}

describe('loadPulseSnapshot', () => {
  it('returns null when the pulse channel is absent (pre-wiring)', async () => {
    expect(await loadPulseSnapshot(fallbackClient)).toBeNull()
  })

  it('unwraps the IPC envelope and forwards the context input', async () => {
    let received: unknown = 'not-called'
    const client = {
      ...fallbackClient,
      pulse: {
        snapshot: async (input?: PulseSnapshotInput) => {
          received = input
          return { ok: true, data: SNAPSHOT }
        },
      },
    } as unknown as FinagentClient

    const input: PulseSnapshotInput = {
      watchlist: [{ symbol: 'AAPL.US', lastPrice: 100 }],
      portfolioSummary: { totalAssets: 10_000 },
    }
    const snapshot = await loadPulseSnapshot(client, input)
    expect(snapshot).toEqual(SNAPSHOT)
    expect(received).toEqual(input)
  })

  it('returns null on a failing envelope or a throwing channel', async () => {
    const failing = {
      ...fallbackClient,
      pulse: { snapshot: async () => ({ ok: false, error: 'boom' }) },
    } as unknown as FinagentClient
    expect(await loadPulseSnapshot(failing)).toBeNull()

    const throwing = {
      ...fallbackClient,
      pulse: {
        snapshot: async () => {
          throw new Error('ipc down')
        },
      },
    } as unknown as FinagentClient
    expect(await loadPulseSnapshot(throwing)).toBeNull()
  })
})

describe('partitionPulseMovers', () => {
  it('splits gainers from losers by change sign', () => {
    const { gainers, losers } = partitionPulseMovers([
      mover('AAPL.US', 6.2),
      mover('MSFT.US', -3.4),
      mover('C.US', 0),
    ])
    expect(gainers.map((m) => m.symbol)).toEqual(['AAPL.US'])
    expect(losers.map((m) => m.symbol)).toEqual(['MSFT.US'])
  })

  it('is empty-safe', () => {
    expect(partitionPulseMovers([])).toEqual({ gainers: [], losers: [] })
  })
})
