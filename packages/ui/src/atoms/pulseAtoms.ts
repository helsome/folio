import { atom } from 'jotai'
import type { FinagentClient } from '../client'
import { loadPulseSnapshot, type MarketPulseSnapshot, type PulseSnapshotInput } from '../client/pulse'
import { portfolioCacheAtom } from './portfolioAtoms'
import { quoteCacheAtomFamily, watchlistAtom } from './quoteAtoms'

/**
 * Market Pulse view state (spec §51–52).
 *
 * The snapshot is computed in the main process (capability registry ×
 * screening service) and exposed over IPC. The channel
 * (`FinagentClient.pulse.snapshot()`) is wired by the Lead at integration; the
 * loader degrades to `null` until then, so the card renders its empty states.
 *
 * The personal-impact context (watchlist quotes + portfolio snapshot) is data
 * the renderer already holds, so it is assembled here and sent along with the
 * snapshot request; the pure mapping still runs in the shared service.
 */

export interface PulseCache {
  snapshot: MarketPulseSnapshot | null
  loading: boolean
  error: string | null
}

export const pulseCacheAtom = atom<PulseCache>({
  snapshot: null,
  loading: false,
  error: null,
})

/** Trigger a fresh snapshot; results land in `pulseCacheAtom`. */
export const loadPulseAtom = atom(null, async (get, set, client: FinagentClient) => {
  set(pulseCacheAtom, (cache) => ({ ...cache, loading: true, error: null }))
  try {
    const portfolio = get(portfolioCacheAtom)
    const input: PulseSnapshotInput = {
      watchlist: get(watchlistAtom).map((symbol) => {
        const cache = get(quoteCacheAtomFamily(symbol))
        return { symbol, ...(cache.data ? { lastPrice: cache.data.lastPrice } : {}) }
      }),
      ...(portfolio.data ? { portfolioSummary: portfolio.data } : {}),
    }
    const snapshot = await loadPulseSnapshot(client, input)
    set(pulseCacheAtom, { snapshot, loading: false, error: null })
    return snapshot
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Market pulse failed to load'
    set(pulseCacheAtom, (cache) => ({ ...cache, loading: false, error: message }))
    return null
  }
})
