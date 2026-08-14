import type { ScreeningRun } from '@finagent/core'
import type { JsonFileStore } from '../storage/json-file-store.ts'

/**
 * Screening run persistence — a single JSON file under the injected store
 * root (the kernel host points it at `userData`):
 *
 *   screening-runs.json   — all runs, newest first
 */
const RUNS_FILE = 'screening-runs.json'

interface RunsFile {
  runs: ScreeningRun[]
}

export class ScreeningRunRepository {
  private readonly store: JsonFileStore

  constructor(store: JsonFileStore) {
    this.store = store
  }

  async saveRun(run: ScreeningRun): Promise<void> {
    const file = await this.store.read<RunsFile>(RUNS_FILE, { runs: [] })
    await this.store.write(RUNS_FILE, {
      runs: [run, ...file.runs.filter((entry) => entry.id !== run.id)],
    })
  }

  async getRun(runId: string): Promise<ScreeningRun | undefined> {
    const file = await this.store.read<RunsFile>(RUNS_FILE, { runs: [] })
    return file.runs.find((entry) => entry.id === runId)
  }

  async listRuns(): Promise<ScreeningRun[]> {
    const file = await this.store.read<RunsFile>(RUNS_FILE, { runs: [] })
    return file.runs
  }
}
