/**
 * Manual portfolio persistence (spec §49, §93).
 *
 * Manual portfolios are a SEPARATE account kind from broker-synced accounts —
 * they are never merged into the broker snapshot. Persistence is a single
 * `manual-portfolios.json` under the userData dir backing the JsonFileStore.
 * Only CONFIRMED drafts reach this repository; draft creation itself never
 * writes anything.
 */
import type { Holding, ManualPortfolio } from '@finagent/core'
import { resolve as resolvePath } from 'node:path'
import type { JsonFileStore } from '../storage/json-file-store.ts'
import { createPortfolioId } from './draft.ts'

export interface ManualPortfolioInput {
  name: string
  currency?: string
  holdings: Holding[]
}

/**
 * Confirmation contract: create/update are the ONLY paths that persist a
 * manual portfolio. Parsing and drafts (parsers.ts, draft.ts) stay side-effect
 * free so an abandoned import never touches disk (spec §93).
 */
export class ManualPortfolioRepository {
  private static readonly FILE = 'manual-portfolios.json'
  private static readonly mutations = new Map<string, Promise<void>>()

  private readonly store: JsonFileStore

  constructor(store: JsonFileStore) {
    this.store = store
  }

  /** Serialize the whole read-modify-write transaction across repository instances. */
  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    const path = resolvePath(this.store.resolve(ManualPortfolioRepository.FILE))
    const key = process.platform === 'win32' ? path.toLowerCase() : path
    const previous = ManualPortfolioRepository.mutations.get(key) ?? Promise.resolve()
    const result = previous.then(operation)
    // A failed mutation must not poison later writes to the same file.
    const settled = result.then(() => undefined, () => undefined)
    ManualPortfolioRepository.mutations.set(key, settled)
    try {
      return await result
    } finally {
      if (ManualPortfolioRepository.mutations.get(key) === settled) {
        ManualPortfolioRepository.mutations.delete(key)
      }
    }
  }

  async list(): Promise<ManualPortfolio[]> {
    let file: unknown
    try {
      file = await this.store.read<unknown>(ManualPortfolioRepository.FILE, {
        portfolios: [],
      })
    } catch {
      // Corrupt / unreadable file — degrade to empty, never crash.
      return []
    }

    if (file === null || typeof file !== 'object') return []
    const portfolios = (file as { portfolios?: unknown }).portfolios
    return Array.isArray(portfolios) ? (portfolios as ManualPortfolio[]) : []
  }

  async get(id: string): Promise<ManualPortfolio | undefined> {
    const portfolios = await this.list()
    return portfolios.find((portfolio) => portfolio.id === id)
  }

  /** Persist a confirmed import as a new manual portfolio. */
  async create(input: ManualPortfolioInput): Promise<ManualPortfolio> {
    return this.mutate(async () => {
      const portfolios = await this.list()
      const portfolio: ManualPortfolio = {
        id: createPortfolioId(),
        name: input.name,
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        holdings: input.holdings,
        updatedAt: Date.now(),
      }
      portfolios.push(portfolio)
      await this.store.write(ManualPortfolioRepository.FILE, { portfolios })
      return portfolio
    })
  }

  /** Replace an existing portfolio; throws when the id is unknown. */
  async update(id: string, input: ManualPortfolioInput): Promise<ManualPortfolio> {
    return this.mutate(async () => {
      const portfolios = await this.list()
      const index = portfolios.findIndex((portfolio) => portfolio.id === id)
      if (index < 0) {
        throw new Error(`Manual portfolio "${id}" not found`)
      }
      const updated: ManualPortfolio = {
        ...portfolios[index],
        name: input.name,
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        holdings: input.holdings,
        updatedAt: Date.now(),
      }
      portfolios[index] = updated
      await this.store.write(ManualPortfolioRepository.FILE, { portfolios })
      return updated
    })
  }

  /** Delete a manual portfolio; no-op when the id is unknown. */
  async delete(id: string): Promise<void> {
    return this.mutate(async () => {
      const portfolios = await this.list()
      const remaining = portfolios.filter((portfolio) => portfolio.id !== id)
      if (remaining.length === portfolios.length) return
      await this.store.write(ManualPortfolioRepository.FILE, { portfolios: remaining })
    })
  }
}

export type { Holding, ManualPortfolio }
