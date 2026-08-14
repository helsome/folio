import type { ResearchDiff } from '@finagent/core'
import type { JsonFileStore } from '../storage/json-file-store.ts'

/**
 * Research diff persistence. One JSON file under the injected store root
 * (which the kernel host points at `userData`):
 *
 *   research-diffs.json — ResearchDiff list, newest first
 *
 * Diffs are upserted by their stable id (hash of the report id pair), so a
 * re-run of the same pair never duplicates.
 */
const DIFFS_FILE = 'research-diffs.json'

interface DiffsFile {
  diffs: ResearchDiff[]
}

export class ResearchDiffRepository {
  private readonly store: JsonFileStore

  constructor(store: JsonFileStore) {
    this.store = store
  }

  /** Upsert a diff; the persisted list stays sorted newest-first. */
  async save(diff: ResearchDiff): Promise<void> {
    const file = await this.store.read<DiffsFile>(DIFFS_FILE, { diffs: [] })
    const next = [diff, ...file.diffs.filter((existing) => existing.id !== diff.id)]
    next.sort((a, b) => b.generatedAt - a.generatedAt || a.id.localeCompare(b.id))
    await this.store.write(DIFFS_FILE, { diffs: next })
  }

  async get(diffId: string): Promise<ResearchDiff | undefined> {
    const file = await this.store.read<DiffsFile>(DIFFS_FILE, { diffs: [] })
    return file.diffs.find((diff) => diff.id === diffId)
  }

  /** The most recent diff for a symbol (drives automation + the What Changed UI). */
  async getBySymbol(symbol: string): Promise<ResearchDiff | undefined> {
    const normalized = symbol.trim().toUpperCase()
    const file = await this.store.read<DiffsFile>(DIFFS_FILE, { diffs: [] })
    return file.diffs.find((diff) => diff.symbol === normalized)
  }

  async list(): Promise<ResearchDiff[]> {
    const file = await this.store.read<DiffsFile>(DIFFS_FILE, { diffs: [] })
    return file.diffs
  }
}
