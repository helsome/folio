/**
 * Tiny in-memory TTL cache for provider responses.
 *
 * Massive (Polygon.io) free tier is limited to 5 API calls/minute, so parsed
 * responses are cached to keep the router smoke test and repeated UI renders
 * under the cap. Entries are keyed by the caller (capability + input); this
 * class only owns expiry and bounded eviction.
 */

export interface TtlCacheOptions {
  /** Entry lifetime in milliseconds (default 5 minutes). */
  ttlMs?: number
  /** Maximum number of live entries (default 50); oldest evicted first. */
  maxEntries?: number
}

const DEFAULT_TTL_MS = 5 * 60 * 1000
const DEFAULT_MAX_ENTRIES = 50

interface Entry<T> {
  value: T
  expiresAt: number
}

export class TtlCache<T> {
  private readonly entries = new Map<string, Entry<T>>()
  private readonly ttlMs: number
  private readonly maxEntries: number

  constructor(options: TtlCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
  }

  /** Returns the cached value when present and unexpired, else `undefined`. */
  get(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (Date.now() >= entry.expiresAt) {
      this.entries.delete(key)
      return undefined
    }
    return entry.value
  }

  set(key: string, value: T): void {
    if (!this.entries.has(key) && this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest !== undefined) this.entries.delete(oldest)
    }
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs })
  }

  clear(): void {
    this.entries.clear()
  }
}
