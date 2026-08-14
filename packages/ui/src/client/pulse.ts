import type { MarketStatus, ScreeningCandidate } from '@finagent/core'
import type { FinagentClient } from '../client'
import { unwrapIpcResult } from './unwrap'

/**
 * Defensive loader for the `pulse:snapshot` IPC surface.
 *
 * `FinagentClient.pulse` is wired by the Lead at integration (preload +
 * renderer client + kernelHost handler). Everything here degrades to
 * `null` / empty when the channel (or its method) is missing, so the Market
 * Pulse card renders its honest empty states instead of crashing — mirroring
 * the screening loader contract.
 *
 * The snapshot types below are the renderer-facing MIRROR of
 * `packages/shared/src/pulse/service.ts` (the UI never imports
 * `@finagent/shared` — that package drags node/executor code into the
 * renderer; same convention as `discoverAtoms`/`diagnostics`). Keep the two
 * shapes in sync when the IPC payload changes.
 */

export interface PulseMarketIndex {
  symbol: string
  name: string
  lastPrice?: number
  changePercent?: number
}

export interface PulseTemperature {
  score?: number
  label?: string
  market?: string
}

export type PulseImpactSign = 'positive' | 'negative' | 'neutral'

export interface PulsePersonalImpactItem {
  symbol: string
  changePercent?: number
  watchlistExposurePercent?: number
  portfolioExposurePercent?: number
  impact: PulseImpactSign
}

export interface PulsePersonalImpact {
  scope: 'watchlist'
  items: PulsePersonalImpactItem[]
}

export interface MarketPulseSnapshot {
  indices: PulseMarketIndex[]
  marketStatus: MarketStatus[] | null
  temperature: PulseTemperature | null
  movers: ScreeningCandidate[]
  personalImpact: PulsePersonalImpact | null
  failures: string[]
  generatedAt: number
}

export interface PulseChannel {
  snapshot: (input?: unknown) => Promise<unknown>
}

/** User context the renderer already holds, fed to the main-side snapshot. */
export interface PulseSnapshotInput {
  watchlist?: { symbol: string; lastPrice?: number }[]
  portfolioSummary?: unknown
}

function channel(client: FinagentClient): Partial<PulseChannel> {
  // Structural extension point: the Lead adds `pulse` to FinagentClient.
  const pulse = (client as { pulse?: Partial<PulseChannel> }).pulse
  return pulse ?? {}
}

/**
 * Fetch one market-pulse snapshot; null when the channel is absent or fails.
 * The optional context carries the watchlist/portfolio data the renderer
 * already has, so the main process can map movers onto the user's exposure.
 */
export async function loadPulseSnapshot(
  client: FinagentClient,
  input?: PulseSnapshotInput
): Promise<MarketPulseSnapshot | null> {
  const snapshot = channel(client).snapshot
  if (typeof snapshot !== 'function') return null
  try {
    return unwrapIpcResult<MarketPulseSnapshot>(await snapshot(input))
  } catch {
    return null
  }
}

/**
 * Split the flat movers list into the card's two columns by change sign
 * (mirror of the shared `partitionMovers`). Candidates without a usable
 * changePercent land in neither column.
 */
export function partitionPulseMovers(
  candidates: ScreeningCandidate[]
): { gainers: ScreeningCandidate[]; losers: ScreeningCandidate[] } {
  const gainers: ScreeningCandidate[] = []
  const losers: ScreeningCandidate[] = []
  for (const candidate of candidates) {
    const changePercent = toFiniteNumber(candidate.metrics?.changePercent)
    if (changePercent === undefined || changePercent === 0) continue
    if (changePercent > 0) gainers.push(candidate)
    else losers.push(candidate)
  }
  return { gainers, losers }
}

/** Coerce a number or numeric string into a finite number (mirror of the shared guard). */
export function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}
