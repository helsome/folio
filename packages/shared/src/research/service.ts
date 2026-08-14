import type {
  CapabilityRegistry,
  ResearchReport,
  ResearchRunSummary,
  ResearchSynthesizer,
  StrategyId,
} from '@finagent/core';
import { createCodeError } from '../agent/errors.ts';
import { isStrategyId } from '../strategies/presets.ts';
import { planForStrategy } from './planner.ts';
import { ResearchReportRepository } from './repository.ts';
import { ResearchRunner } from './runner.ts';

export interface ResearchServiceOptions {
  registry: CapabilityRegistry;
  synthesizer: ResearchSynthesizer;
  repository: ResearchReportRepository;
  now?: () => number;
  /** V5: called after a report is persisted (opinion creation hook). */
  onReport?: (report: ResearchReport) => Promise<void> | void;
}

interface ActiveRun {
  runId: string;
  controller: AbortController;
}


/**
 * Application-facing Deep Research API. Owns the run lifecycle: at most one
 * run per symbol at a time, abortable, with progress summaries persisted to
 * the repository for the UI.
 */
export class ResearchService {
  private readonly registry: CapabilityRegistry;
  private readonly synthesizer: ResearchSynthesizer;
  private readonly repository: ResearchReportRepository;
  private readonly now: () => number;
  private readonly runner: ResearchRunner;
  private readonly onReport?: (report: ResearchReport) => Promise<void> | void;

  private readonly active = new Map<string, ActiveRun>();
  private readonly memory = new Map<string, ResearchRunSummary>();
  private sequence = 0;

  constructor(options: ResearchServiceOptions) {
    this.registry = options.registry;
    this.synthesizer = options.synthesizer;
    this.repository = options.repository;
    this.now = options.now ?? Date.now;
    this.onReport = options.onReport;
    this.runner = new ResearchRunner({
      registry: this.registry,
      synthesizer: this.synthesizer,
      now: this.now,
    });
    // Runs the previous process left non-terminal crashed with it; recover
    // them so the UI never shows an eternally-active run.
    void this.recoverStaleRuns();
  }

  async start(symbol: string, strategyId?: StrategyId): Promise<ResearchRunSummary> {
    const key = normalizeSymbol(symbol);
    if (!key) {
      throw createCodeError('RESEARCH_SYMBOL_INVALID', 'Research requires a non-empty symbol.');
    }
    if (strategyId !== undefined && !isStrategyId(strategyId)) {
      throw createCodeError(
        'RESEARCH_STRATEGY_INVALID',
        `Unknown research strategy: ${String(strategyId)}.`
      );
    }
    if (this.active.has(key)) {
      throw createCodeError(
        'RESEARCH_RUN_ACTIVE',
        `A research run for ${key} is already active.`
      );
    }

    const runId = this.genRunId(key);
    const summary: ResearchRunSummary = {
      id: runId,
      symbol: key,
      status: 'queued',
      startedAt: this.now(),
      plannedCapabilities: planForStrategy(strategyId, this.registry).map((p) => p.capabilityId),
      completedCapabilities: [],
      failedCapabilities: [],
    };

    const controller = new AbortController();
    this.active.set(key, { runId, controller });
    this.memory.set(runId, summary);
    await this.repository.saveRunSummary(summary);

    void this.execute(key, runId, controller.signal, strategyId);
    return summary;
  }

  async cancel(runId: string): Promise<void> {
    for (const active of this.active.values()) {
      if (active.runId === runId) {
        active.controller.abort();
        return;
      }
    }
    throw createCodeError('RESEARCH_RUN_NOT_FOUND', `No active run with id ${runId}.`);
  }

  async getRun(runId: string): Promise<ResearchRunSummary | undefined> {
    const inMemory = this.memory.get(runId);
    if (inMemory) return inMemory;
    return this.repository.getRunSummary(runId);
  }

  async getReport(reportId: string): Promise<ResearchReport | undefined> {
    return this.repository.getReport(reportId);
  }

  async listReports(symbol?: string): Promise<ResearchReport[]> {
    if (symbol) {
      return this.repository.listBySymbol(normalizeSymbol(symbol));
    }
    const summaries = await this.repository.listSummaries();
    const reports = await Promise.all(summaries.map((s) => this.repository.getReport(s.id)));
    return reports.filter((report): report is ResearchReport => report !== undefined);
  }

  async listRuns(): Promise<ResearchRunSummary[]> {
    const persisted = await this.repository.listRunSummaries();
    const merged = new Map(persisted.map((r) => [r.id, r]));
    for (const [id, summary] of this.memory) {
      merged.set(id, summary);
    }
    return [...merged.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  private async execute(
    key: string,
    runId: string,
    signal: AbortSignal,
    strategyId?: StrategyId
  ): Promise<void> {
    try {
      const result = await this.runner.run({
        symbol: key,
        runId,
        strategyId,
        signal,
        onStatus: async (summary) => {
          this.memory.set(runId, summary);
          await this.repository.saveRunSummary(summary);
        },
      });
      this.memory.set(runId, result.summary);
      if (result.report) {
        await this.repository.saveReport(result.report);
        await this.onReport?.(result.report);
      }
    } finally {
      this.active.delete(key);
    }
  }

  /**
   * Runs persisted in a non-terminal status belong to a process that died
   * mid-run. Mark them failed so restart never resurrects a zombie run.
   */
  private async recoverStaleRuns(): Promise<void> {
    try {
      const summaries = await this.repository.listRunSummaries();
      for (const summary of summaries) {
        if (
          summary.status === 'completed' ||
          summary.status === 'partial' ||
          summary.status === 'failed' ||
          summary.status === 'cancelled'
        ) {
          continue;
        }
        const recovered: ResearchRunSummary = {
          ...summary,
          status: 'failed',
          finishedAt: summary.finishedAt ?? this.now(),
        };
        this.memory.set(recovered.id, recovered);
        await this.repository.saveRunSummary(recovered);
      }
    } catch {
      // Recovery is best-effort; a corrupt run index must not block startup.
    }
  }

  private genRunId(key: string): string {
    this.sequence += 1;
    const slug = key.replace(/\./g, '_');
    return `research-${slug}-${this.now()}-${this.sequence}`;
  }
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}
