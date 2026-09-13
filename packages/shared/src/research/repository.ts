import type { ResearchReport, ResearchRunSummary, ResearchStance } from '@finagent/core';
import type { JsonFileStore } from '../storage/json-file-store.ts';
import { mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { decodeCheckpoint, encodeCheckpoint, type ResearchCheckpoint } from './checkpoint.ts';

/**
 * Deep Research persistence. Layout under the injected store root (which the
 * kernel host points at `userData`):
 *
 *   research/index.json            — per-symbol report summary index
 *   research/reports/<id>.json     — full ResearchReport
 *   research/runs.json             — ResearchRunSummary progress records
 */
const INDEX_FILE = 'research/index.json';
const RUNS_FILE = 'research/runs.json';
const reportFile = (id: string) => `research/reports/${id}.json`;

export interface ReportSummary {
  id: string;
  symbol: string;
  generatedAt: number;
  stance: ResearchStance;
  confidence: number;
}

interface IndexFile {
  reports: ReportSummary[];
}

interface RunsFile {
  runs: ResearchRunSummary[];
}

export class ResearchReportRepository {
  private readonly store: JsonFileStore;
  private writes: Promise<unknown> = Promise.resolve();

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.writes.then(work);
    this.writes = result.catch(() => undefined);
    return result;
  }

  private checkpointFile(runId: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(runId)) throw new Error('Invalid research run id.');
    return this.store.resolve('research/checkpoints/' + runId + '.json');
  }

  async listCheckpointIds(): Promise<string[]> {
    try {
      return (await readdir(this.store.resolve('research/checkpoints')))
        .filter((name) => /^[a-zA-Z0-9_-]+\.json$/.test(name)).map((name) => name.slice(0, -5));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  async getCheckpoint(runId: string): Promise<ResearchCheckpoint | undefined> {
    const file = this.checkpointFile(runId);
    try {
      return decodeCheckpoint(await readFile(file, 'utf8'), runId);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async saveCheckpoint(cp: ResearchCheckpoint): Promise<void> {
    // Serialize and validate now: workers must not mutate an enqueued snapshot.
    const data = encodeCheckpoint(cp);
    const file = this.checkpointFile(cp.summary.id);
    return this.serialize(async () => {
      await mkdir(dirname(file), { recursive: true });
      const tmp = file + '.' + randomUUID() + '.tmp';
      try {
        const handle = await open(tmp, 'wx', 0o600);
        try {
          await handle.writeFile(data, 'utf8');
          await handle.sync();
        } finally { await handle.close(); }
        // Windows readers/AV can briefly hold a destination without delete sharing.
        // Retry the atomic replacement; never unlink the last good checkpoint.
        for (let attempt = 0; ; attempt++) {
          try { await rename(tmp, file); break; }
          catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (process.platform !== 'win32' || attempt === 5 || !['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '')) throw error;
            await delay(20 * 2 ** attempt);
          }
        }
        // Windows does not support opening directories for fsync.
        if (process.platform !== 'win32') {
          const directory = await open(dirname(file), 'r');
          try { await directory.sync(); } finally { await directory.close(); }
        }
      } finally {
        await unlink(tmp).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
      }
    });
  }

  constructor(store: JsonFileStore) {
    this.store = store;
  }

  async saveReport(report: ResearchReport): Promise<void> {
    return this.serialize(async () => {
      await this.store.write(reportFile(report.id), report);
      const index = await this.store.read<IndexFile>(INDEX_FILE, { reports: [] });
      const entry: ReportSummary = {
        id: report.id,
        symbol: report.symbol,
        generatedAt: report.generatedAt,
        stance: report.stance,
        confidence: report.confidence,
      };
      await this.store.write(INDEX_FILE, {
        reports: [entry, ...index.reports.filter((r) => r.id !== report.id)],
      });
    });
  }

  async getReport(reportId: string): Promise<ResearchReport | undefined> {
    return this.store.read<ResearchReport | undefined>(reportFile(reportId), undefined);
  }

  async listBySymbol(symbol: string): Promise<ResearchReport[]> {
    const index = await this.store.read<IndexFile>(INDEX_FILE, { reports: [] });
    const ids = index.reports.filter((r) => r.symbol === symbol).map((r) => r.id);
    const reports = await Promise.all(ids.map((id) => this.getReport(id)));
    return reports.filter((report): report is ResearchReport => report !== undefined);
  }

  async listSummaries(): Promise<ReportSummary[]> {
    const index = await this.store.read<IndexFile>(INDEX_FILE, { reports: [] });
    return index.reports;
  }

  async saveRunSummary(summary: ResearchRunSummary): Promise<void> {
    return this.serialize(async () => {
      const runs = await this.store.read<RunsFile>(RUNS_FILE, { runs: [] });
      await this.store.write(RUNS_FILE, {
        runs: [summary, ...runs.runs.filter((r) => r.id !== summary.id)],
      });
    });
  }

  async getRunSummary(runId: string): Promise<ResearchRunSummary | undefined> {
    const runs = await this.store.read<RunsFile>(RUNS_FILE, { runs: [] });
    return runs.runs.find((r) => r.id === runId);
  }

  async listRunSummaries(): Promise<ResearchRunSummary[]> {
    const runs = await this.store.read<RunsFile>(RUNS_FILE, { runs: [] });
    return runs.runs;
  }

  async replaceRunSummaries(runs: ResearchRunSummary[]): Promise<void> {
    return this.serialize(() => this.store.write(RUNS_FILE, { runs }));
  }
}
