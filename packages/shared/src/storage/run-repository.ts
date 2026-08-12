import type { Run } from '@finagent/core';
import type { JsonFileStore } from './json-file-store.ts';

interface RunsFile {
  runs: Run[];
}

/** Persists run history of one session as a JSON array (newest first). */
export class RunRepository {
  private readonly store: JsonFileStore;

  constructor(store: JsonFileStore) {
    this.store = store;
  }

  private fileFor(sessionId: string): string {
    return `sessions/${sessionId}/runs.json`;
  }

  async list(sessionId: string): Promise<Run[]> {
    const file = await this.store.read<RunsFile>(this.fileFor(sessionId), { runs: [] });
    return [...file.runs].sort((a, b) => b.startedAt - a.startedAt);
  }

  async get(sessionId: string, runId: string): Promise<Run | null> {
    const runs = await this.list(sessionId);
    return runs.find((run) => run.id === runId) ?? null;
  }

  async create(run: Run): Promise<void> {
    const file = await this.store.read<RunsFile>(this.fileFor(run.sessionId), { runs: [] });
    file.runs.push(run);
    await this.store.write(this.fileFor(run.sessionId), file);
  }

  async update(run: Run): Promise<void> {
    const file = await this.store.read<RunsFile>(this.fileFor(run.sessionId), { runs: [] });
    const index = file.runs.findIndex((existing) => existing.id === run.id);
    if (index >= 0) {
      file.runs[index] = run;
    } else {
      file.runs.push(run);
    }
    await this.store.write(this.fileFor(run.sessionId), file);
  }
}
