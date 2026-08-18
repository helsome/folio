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
import type { JsonFileStore } from '../storage/json-file-store.ts';
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

  constructor(store: JsonFileStore) {
    this.store = store;
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

  private async save(shape: StoreShape): Promise<void> {
    await this.store.write(FILE, shape);
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
    const shape = await this.load();
    shape.settings = sanitizeSettings({ ...settings, updatedAt: Date.now() });
    await this.save(shape);
    return shape.settings;
  }

  // ── datasets ────────────────────────────────────────────────────────────

  async listDatasets(): Promise<EvaluationDataset[]> {
    return (await this.load()).datasets;
  }

  async putDataset(dataset: EvaluationDataset): Promise<void> {
    const shape = await this.load();
    const index = shape.datasets.findIndex((d) => d.id === dataset.id);
    if (index >= 0) {
      shape.datasets[index] = dataset;
    } else {
      shape.datasets.push(dataset);
    }
    await this.save(shape);
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
    const shape = await this.load();
    shape.experiments.push(experiment);
    await this.save(shape);
  }

  async updateExperiment(experiment: EvaluationExperiment): Promise<void> {
    const shape = await this.load();
    const index = shape.experiments.findIndex((e) => e.id === experiment.id);
    if (index < 0) throw new Error(`Experiment ${experiment.id} not found.`);
    shape.experiments[index] = experiment;
    await this.save(shape);
  }

  // ── runs & results ──────────────────────────────────────────────────────

  async addRun(run: EvaluationRun): Promise<void> {
    const shape = await this.load();
    shape.runs.push(run);
    if (shape.runs.length > 5000) shape.runs.splice(0, shape.runs.length - 5000);
    await this.save(shape);
  }

  async listRuns(experimentId?: string): Promise<EvaluationRun[]> {
    const shape = await this.load();
    return experimentId ? shape.runs.filter((r) => r.experimentId === experimentId) : shape.runs;
  }

  async addResult(result: EvaluationResultRecord): Promise<void> {
    const shape = await this.load();
    shape.results.push(result);
    await this.save(shape);
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
    const shape = await this.load();
    shape.baselines.push(baseline);
    await this.save(shape);
  }

  // ── trace links (spec §52) ──────────────────────────────────────────────

  async recordTraceLink(link: TraceLinkRecord): Promise<void> {
    const shape = await this.load();
    const existing = shape.traceLinks.findIndex((l) => l.runId === link.runId);
    if (existing >= 0) {
      shape.traceLinks[existing] = link;
    } else {
      shape.traceLinks.push(link);
    }
    if (shape.traceLinks.length > 10_000) shape.traceLinks.splice(0, shape.traceLinks.length - 10_000);
    await this.save(shape);
  }

  async lookupTraceLink(runId: string): Promise<TraceLinkRecord | undefined> {
    return (await this.load()).traceLinks.find((l) => l.runId === runId);
  }

  // ── human feedback (spec §82) ───────────────────────────────────────────

  async addFeedback(feedback: HumanFeedback): Promise<void> {
    const shape = await this.load();
    shape.feedback.push(feedback);
    await this.save(shape);
  }

  async listFeedback(): Promise<HumanFeedback[]> {
    return (await this.load()).feedback;
  }
}