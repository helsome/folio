import type { ResearchOpinion, ResearchOutcome } from '@finagent/core'
import { resolve } from 'node:path'
import type { JsonFileStore } from '../storage/json-file-store.ts'
import { HORIZON_MS } from './engine.ts'

/**
 * Opinion + outcome persistence. Both collections share one store file
 * (`<userData>/outcomes.json`, JsonFileStore pattern) so due-opinion lookups
 * can cross-check evaluated status in a single read.
 *
 *   outcomes.json → { opinions: ResearchOpinion[], outcomes: ResearchOutcome[] }
 *
 * Opinions are newest-first; outcomes newest-first, at most one per opinion.
 */

const FILE = 'outcomes.json'

// One queue per file, shared by repository/store instances in this process.
// Atomic rename alone cannot protect a read-modify-write from stale snapshots.
const writeLocks = new Map<string, Promise<void>>()

interface OutcomesFile {
  opinions: ResearchOpinion[]
  outcomes: ResearchOutcome[]
}

export class OutcomeRepository {
  private readonly store: JsonFileStore

  constructor(store: JsonFileStore) {
    this.store = store
  }

  private async read(): Promise<OutcomesFile> {
    return this.store.read<OutcomesFile>(FILE, { opinions: [], outcomes: [] })
  }

  private async write(file: OutcomesFile): Promise<void> {
    await this.store.write(FILE, file)
  }

  private async update(change: (file: OutcomesFile) => OutcomesFile): Promise<void> {
    const target = resolve(this.store.resolve(FILE))
    const previous = writeLocks.get(target) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(async () => {
      await this.write(change(await this.read()))
    })
    writeLocks.set(target, current)
    try {
      await current
    } finally {
      if (writeLocks.get(target) === current) writeLocks.delete(target)
    }
  }

  /** Upsert an opinion (deterministic id → re-persisting a report is idempotent). */
  async saveOpinion(opinion: ResearchOpinion): Promise<void> {
    await this.update((file) => ({
      ...file,
      opinions: [opinion, ...file.opinions.filter((o) => o.id !== opinion.id)],
    }))
  }

  async getOpinion(opinionId: string): Promise<ResearchOpinion | undefined> {
    const file = await this.read()
    return file.opinions.find((o) => o.id === opinionId)
  }

  /** All opinions, newest first; filtered by symbol when given. */
  async listOpinions(symbol?: string): Promise<ResearchOpinion[]> {
    const file = await this.read()
    if (symbol === undefined) return file.opinions
    return file.opinions.filter((o) => o.symbol === symbol)
  }

  /** Upsert an outcome — one per opinion. */
  async saveOutcome(outcome: ResearchOutcome): Promise<void> {
    await this.update((file) => ({
      ...file,
      outcomes: [outcome, ...file.outcomes.filter((o) => o.opinionId !== outcome.opinionId)],
    }))
  }

  async getOutcomeByOpinionId(opinionId: string): Promise<ResearchOutcome | undefined> {
    const file = await this.read()
    return file.outcomes.find((o) => o.opinionId === opinionId)
  }

  /** Outcomes newest-first; filtered by the opinion's symbol when given. */
  async listOutcomes(symbol?: string): Promise<ResearchOutcome[]> {
    const file = await this.read()
    if (symbol === undefined) return file.outcomes
    const symbolByOpinion = new Map(file.opinions.map((o) => [o.id, o.symbol]))
    return file.outcomes.filter((o) => symbolByOpinion.get(o.opinionId) === symbol)
  }

  /**
   * Opinions whose committed horizon has elapsed (`createdAt + horizonMs < now`,
   * strictly past) and that have no outcome recorded yet — newest first.
   */
  async listDueOpinions(now: number): Promise<ResearchOpinion[]> {
    const file = await this.read()
    const evaluated = new Set(file.outcomes.map((o) => o.opinionId))
    return file.opinions.filter((o) => {
      if (evaluated.has(o.id)) return false
      return o.createdAt + HORIZON_MS[o.horizon] < now
    })
  }
}
