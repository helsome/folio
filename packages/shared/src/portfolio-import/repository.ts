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
import type { JsonFileStore } from '../storage/json-file-store.ts'
import { createPortfolioId } from './draft.ts'

export interface ManualPortfolioInput {
  name: string
  currency?: string
  holdings: Holding[]
}

interface ManualPortfoliosFile {
  portfolios: ManualPortfolio[]
}

/**
 * Confirmation contract: create/update are the ONLY paths that persist a
 * manual portfolio. Parsing and drafts (parsers.ts, draft.ts) stay side-effect
 * free so an abandoned import never touches disk (spec §93).
 */
export class ManualPortfolioRepository {
  private static readonly FILE = 'manual-portfolios.json'

  private readonly store: JsonFileStore

  constructor(store: JsonFileStore) {
    this.store = store
  }

  async list(): Promise<ManualPortfolio[]> {
    let file: ManualPortfoliosFile
    try {
      file = await this.store.read<ManualPortfoliosFile>(ManualPortfolioRepository.FILE, {
        portfolios: [],
      })
    } catch {
      // Corrupt / unreadable file — degrade to empty, never crash.
      return []
    }
    return file.portfolios
  }

  async get(id: string): Promise<ManualPortfolio | undefined> {
    const portfolios = await this.list()
    return portfolios.find((portfolio) => portfolio.id === id)
  }

  /** Persist a confirmed import as a new manual portfolio. */
  async create(input: ManualPortfolioInput): Promise<ManualPortfolio> {
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
  }

  /** Replace an existing portfolio; throws when the id is unknown. */
  async update(id: string, input: ManualPortfolioInput): Promise<ManualPortfolio> {
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
  }

  /** Delete a manual portfolio; no-op when the id is unknown. */
  async delete(id: string): Promise<void> {
    const portfolios = await this.list()
    const remaining = portfolios.filter((portfolio) => portfolio.id !== id)
    if (remaining.length === portfolios.length) return
    await this.store.write(ManualPortfolioRepository.FILE, { portfolios: remaining })
  }
}

export type { Holding, ManualPortfolio }
