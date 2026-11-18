// EvaluationStore: durable records for datasets, runs, results, experiments,
// baselines, trace links and human feedback (spec §15, §17, §52, §82).
import type {
  EvaluationBaseline,
  EvaluationDataset,
  EvaluationExperiment,
  EvaluationResultRecord,
  EvaluationRun,
  EvaluationSettings,
  TraceReference,
} from '@finagent/core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { JsonFileStore } from '../storage/json-file-store.ts';
import { withWriteLock } from '../storage/write-lock.ts';
import { DEFAULT_EVALUATION_SETTINGS, sanitizeSettings } from './settings.ts';

export interface TraceLinkRecord {
  /** Folio run id. */
  runId: string;
  traceRef: TraceReference;
  recordedAt: number;
}

export interface HumanFeedback {
  id: string;
  caseId: string;
  runId?: string;
  verdict: 'good' | 'bad';
  note?: string;
  createdAt: number;
}

interface StoreShape {
  settings: EvaluationSettings;
  datasets: EvaluationDataset[];
  experiments: EvaluationExperiment[];
  runs: EvaluationRun[];
  results: EvaluationResultRecord[];
  baselines: EvaluationBaseline[];
  traceLinks: TraceLinkRecord[];
  feedback: HumanFeedback[];
}

function emptyStore(): StoreShape {
  return {
    settings: { ...DEFAULT_EVALUATION_SETTINGS },
    datasets: [],
    experiments: [],
    runs: [],
    results: [],
    baselines: [],
    traceLinks: [],
    feedback: [],
  };
}

const FILE = 'evaluation/store.json';

/** Single-file JSON store following the repo's JsonFileStore convention. */
export class EvaluationStore {
  private readonly store: JsonFileStore;
  private readonly writeLockKey: string;

  constructor(store: JsonFileStore) {
    this.store = store;
    const path = resolve(store.resolve(FILE));
    this.writeLockKey = process.platform === 'win32' ? path.toLowerCase() : path;
  }

  private async load(): Promise<StoreShape> {
    const raw = await this.store.read<Partial<StoreShape> | null>(FILE, null);
    if (!raw || typeof raw !== 'object') return emptyStore();
    const base = emptyStore();
    return {
      settings: sanitizeSettings(raw.settings),
      datasets: Array.isArray(raw.datasets) ? raw.datasets : base.datasets,
      experiments: Array.isArray(raw.experiments) ? raw.experiments : base.experiments,
      runs: Array.isArray(raw.runs) ? raw.runs : base.runs,
      results: Array.isArray(raw.results) ? raw.results : base.results,
      baselines: Array.isArray(raw.baselines) ? raw.baselines : base.baselines,
      traceLinks: Array.isArray(raw.traceLinks) ? raw.traceLinks : base.traceLinks,
      feedback: Array.isArray(raw.feedback) ? raw.feedback : base.feedback,
    };
  }

  /** Every collection shares one file, so serialize the whole read-modify-write cycle. */
  private async mutate<T>(change: (shape: StoreShape) => T): Promise<T> {
    return withWriteLock(this.writeLockKey, async () => {
      const shape = await this.load();
      const result = change(shape);
      await this.store.write(FILE, shape);
      return result;
    });
  }

  // ── settings ────────────────────────────────────────────────────────────

  async getSettings(): Promise<EvaluationSettings> {
    const shape = await this.load();
    return shape.settings;
  }

  /**
   * Synchronous settings read for the main-process constructor (the Pi
   * extension list must be known before the first runtime spawn). Returns
   * defaults when the file does not exist yet.
   */
  getSettingsSync(): EvaluationSettings {
    try {
      const raw = JSON.parse(readFileSync(this.store.resolve(FILE), 'utf8')) as { settings?: unknown };
      const settings = raw.settings;
      if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
        return sanitizeSettings(settings as Record<string, unknown>);
      }
      return { ...DEFAULT_EVALUATION_SETTINGS };
    } catch {
      return { ...DEFAULT_EVALUATION_SETTINGS };
    }
  }

  async saveSettings(settings: EvaluationSettings): Promise<EvaluationSettings> {
    return this.mutate((shape) => {
      shape.settings = sanitizeSettings({ ...settings, updatedAt: Date.now() });
      return shape.settings;
    });
  }

  // ── datasets ────────────────────────────────────────────────────────────

  async listDatasets(): Promise<EvaluationDataset[]> {
    return (await this.load()).datasets;
  }

  async putDataset(dataset: EvaluationDataset): Promise<void> {
    return this.mutate((shape) => {
      const index = shape.datasets.findIndex((d) => d.id === dataset.id);
      if (index >= 0) {
        shape.datasets[index] = dataset;
      } else {
        shape.datasets.push(dataset);
      }
    });
  }

  // ── experiments ─────────────────────────────────────────────────────────

  async listExperiments(): Promise<EvaluationExperiment[]> {
    const shape = await this.load();
    return [...shape.experiments].sort((a, b) => b.startedAt - a.startedAt);
  }

  async getExperiment(id: string): Promise<EvaluationExperiment | undefined> {
    return (await this.load()).experiments.find((e) => e.id === id);
  }

  async createExperiment(experiment: EvaluationExperiment): Promise<void> {
    return this.mutate((shape) => {
      shape.experiments.push(experiment);
    });
  }

  async updateExperiment(experiment: EvaluationExperiment): Promise<void> {
    return this.mutate((shape) => {
      const index = shape.experiments.findIndex((e) => e.id === experiment.id);
      if (index < 0) throw new Error(`Experiment ${experiment.id} not found.`);
      shape.experiments[index] = experiment;
    });
  }

  // ── runs & results ──────────────────────────────────────────────────────

  async addRun(run: EvaluationRun): Promise<void> {
    return this.mutate((shape) => {
      shape.runs.push(run);
      if (shape.runs.length > 5000) shape.runs.splice(0, shape.runs.length - 5000);
    });
  }

  async listRuns(experimentId?: string): Promise<EvaluationRun[]> {
    const shape = await this.load();
    return experimentId ? shape.runs.filter((r) => r.experimentId === experimentId) : shape.runs;
  }

  async addResult(result: EvaluationResultRecord): Promise<void> {
    return this.mutate((shape) => {
      shape.results.push(result);
    });
  }

  async listResults(experimentId?: string): Promise<EvaluationResultRecord[]> {
    const shape = await this.load();
    return experimentId ? shape.results.filter((r) => r.experimentId === experimentId) : shape.results;
  }

  // ── baselines ───────────────────────────────────────────────────────────

  async listBaselines(): Promise<EvaluationBaseline[]> {
    return (await this.load()).baselines;
  }

  async createBaseline(baseline: EvaluationBaseline): Promise<void> {
    return this.mutate((shape) => {
      shape.baselines.push(baseline);
    });
  }

  // ── trace links (spec §52) ──────────────────────────────────────────────

  async recordTraceLink(link: TraceLinkRecord): Promise<void> {
    return this.mutate((shape) => {
      const existing = shape.traceLinks.findIndex((l) => l.runId === link.runId);
      if (existing >= 0) {
        shape.traceLinks[existing] = link;
      } else {
        shape.traceLinks.push(link);
      }
      if (shape.traceLinks.length > 10_000) shape.traceLinks.splice(0, shape.traceLinks.length - 10_000);
    });
  }

  async lookupTraceLink(runId: string): Promise<TraceLinkRecord | undefined> {
    return (await this.load()).traceLinks.find((l) => l.runId === runId);
  }

  // ── human feedback (spec §82) ───────────────────────────────────────────

  async addFeedback(feedback: HumanFeedback): Promise<void> {
    return this.mutate((shape) => {
      shape.feedback.push(feedback);
    });
  }

  async listFeedback(): Promise<HumanFeedback[]> {
    return (await this.load()).feedback;
  }
}
