import { randomUUID } from 'node:crypto';
import type {
  CapabilityRegistry, ResearchExecutionIdentity, ResearchReport, ResearchRunSummary,
  ResearchSynthesizer, StrategyId, SupportedLocale,
} from '@finagent/core';
import { i18nCurrentLocale } from '@finagent/i18n';
import { redact } from '../diagnostics/redact.ts';
import { createCodeError } from '../agent/errors.ts';
import { createUsage, resolveBudget, type ResolveBudgetInput } from '../kernel/run-budget.ts';
import { isStrategyId } from '../strategies/presets.ts';
import { buildCapabilityInput, planForStrategy } from './planner.ts';
import { CHECKPOINT_VERSION, SETTLED_RESEARCH_STATUSES, type ResearchCheckpoint } from './checkpoint.ts';
import { ResearchReportRepository } from './repository.ts';
import { ResearchRunner, type ResearchRunResult } from './runner.ts';

export interface ResearchServiceOptions {
  registry: CapabilityRegistry;
  synthesizer: ResearchSynthesizer;
  repository: ResearchReportRepository;
  now?: () => number;
  /** Must be idempotent by report id; replayed after a publication crash. */
  onReport?: (report: ResearchReport) => Promise<void> | void;
  /** Observability runs after durable publication and cannot fail the research run. */
  onRunComplete?: (result: ResearchRunResult) => Promise<void> | void;
  getIdentity?: () => Promise<ResearchExecutionIdentity>;
  budgets?: ResolveBudgetInput;
}

interface ActiveRun {
  runId: string;
  controller: AbortController;
  done?: Promise<void>;
}

/** Main-process owner of durable research runs. Renderer state is a projection. */
export class ResearchService {
  private readonly runner: ResearchRunner;
  private readonly now: () => number;
  private readonly active = new Map<string, ActiveRun>();
  private readonly memory = new Map<string, ResearchRunSummary>();
  private readonly ready: Promise<void>;
  private commands: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: ResearchServiceOptions) {
    this.now = options.now ?? Date.now;
    this.runner = new ResearchRunner(options);
    // All public methods await reconciliation: it cannot race with start().
    this.ready = this.reconcile();
    void this.ready.catch(() => undefined);
  }

  private command<T>(work: () => Promise<T>): Promise<T> {
    const result = this.commands.then(async () => { await this.ready; return work(); });
    this.commands = result.catch(() => undefined);
    return result;
  }

  private async identity(): Promise<ResearchExecutionIdentity> {
    return this.options.getIdentity?.() ?? { provider: 'injected', model: 'injected', config: 'v1' };
  }

  start(symbol: string, strategyId?: StrategyId, locale?: SupportedLocale): Promise<ResearchRunSummary> {
    return this.command(() => this.startNew(symbol, strategyId, locale));
  }

  private async startNew(symbol: string, strategyId?: StrategyId, locale?: SupportedLocale): Promise<ResearchRunSummary> {
    const key = symbol.trim().toUpperCase();
    if (!/^[A-Z0-9]{1,5}\.(US|HK|SG|SH|SZ|HAS)$/.test(key)) {
      throw createCodeError('RESEARCH_SYMBOL_INVALID', 'Research requires a valid market symbol.');
    }
    if (strategyId !== undefined && !isStrategyId(strategyId)) {
      throw createCodeError('RESEARCH_STRATEGY_INVALID', 'Unknown research strategy.');
    }
    this.assertInactive(key);
    const plan = planForStrategy(strategyId, this.options.registry)
      .map((p) => ({ ...p, input: buildCapabilityInput(p.capabilityId, key) }));
    const summary: ResearchRunSummary = {
      id: 'research-' + randomUUID(), symbol: key, status: 'queued', startedAt: this.now(),
      plannedCapabilities: plan.map((p) => p.capabilityId),
      completedCapabilities: [], failedCapabilities: [],
      strategyId, locale: locale ?? i18nCurrentLocale(), recoveryCount: 0,
    };
    const cp: ResearchCheckpoint = {
      version: CHECKPOINT_VERSION, summary, plan, outcomes: [], phase: 'fetching',
      identity: await this.identity(),
      budget: { limits: resolveBudget(this.options.budgets ?? {}).limits, usage: createUsage() },
      retry: { attempts: {}, synthesisAttempts: 0 }, inFlight: [],
      events: [{ runId: summary.id, parentRunId: summary.id, spanId: randomUUID(), type: 'started', at: this.now() }],
    };
    await this.persist(cp);
    this.launch(cp);
    return structuredClone(summary);
  }

  resume(runId: string): Promise<ResearchRunSummary> {
    return this.command(async () => {
      const summary = await this.getRun(runId);
      if (!summary) throw createCodeError('RESEARCH_RUN_NOT_FOUND', 'Research run not found.');
      if (this.active.get(summary.symbol)?.runId === runId || SETTLED_RESEARCH_STATUSES.has(summary.status)) return summary;
      this.assertInactive(summary.symbol);
      const cp = await this.options.repository.getCheckpoint(runId);
      if (!cp) throw createCodeError('RESEARCH_CHECKPOINT_MISSING', 'This legacy run has no checkpoint. Restart or discard it.');
      const identity = await this.identity();
      if (JSON.stringify(identity) !== JSON.stringify(cp.identity)) {
        throw createCodeError('RESEARCH_IDENTITY_CHANGED', 'Provider/model/config changed. Restore the original configuration or restart.');
      }
      cp.summary = { ...cp.summary, status: 'recovering', error: undefined, finishedAt: undefined,
        recoverable: false, recoveryCount: (cp.summary.recoveryCount ?? 0) + 1 };
      cp.events.push({ runId, parentRunId: runId, spanId: randomUUID(), type: 'recovery', at: this.now() });
      await this.persist(cp);
      const recovering = structuredClone(cp.summary);
      this.launch(cp);
      return recovering;
    });
  }

  restart(runId: string): Promise<ResearchRunSummary> {
    return this.command(async () => {
      const summary = await this.getRun(runId);
      if (!summary) throw createCodeError('RESEARCH_RUN_NOT_FOUND', 'Research run not found.');
      this.assertInactive(summary.symbol);
      await this.discardRun(runId);
      return this.startNew(summary.symbol, summary.strategyId, summary.locale);
    });
  }

  discard(runId: string): Promise<void> {
    return this.command(() => this.discardRun(runId));
  }

  private async discardRun(runId: string): Promise<void> {
    const summary = await this.getRun(runId);
    if (!summary) throw createCodeError('RESEARCH_RUN_NOT_FOUND', 'Research run not found.');
    this.assertInactive(summary.symbol);
    if (summary.status === 'completed' || summary.status === 'partial') {
      throw createCodeError('RESEARCH_RUN_FINISHED', 'Completed reports cannot be discarded as interrupted runs.');
    }
    const cancelled: ResearchRunSummary = { ...summary, status: 'cancelled', cancelled: true, recoverable: false, finishedAt: this.now() };
    let cp: ResearchCheckpoint | undefined;
    try { cp = await this.options.repository.getCheckpoint(runId); } catch { /* Preserve corrupt original. */ }
    if (cp) { cp.summary = cancelled; await this.persist(cp); }
    else { await this.options.repository.saveRunSummary(cancelled); this.memory.set(runId, cancelled); }
  }

  async cancel(runId: string): Promise<void> {
    await this.ready;
    const active = [...this.active.values()].find((run) => run.runId === runId);
    if (!active) throw createCodeError('RESEARCH_RUN_NOT_FOUND', 'No active research run.');
    active.controller.abort();
    const cp = await this.options.repository.getCheckpoint(runId);
    if (cp) await this.persist(cp);
    await active.done;
  }

  async getRun(runId: string): Promise<ResearchRunSummary | undefined> {
    await this.ready;
    return structuredClone(this.memory.get(runId) ?? await this.options.repository.getRunSummary(runId));
  }

  async listRuns(): Promise<ResearchRunSummary[]> {
    await this.ready;
    return structuredClone([...this.memory.values()].reverse().sort((a, b) => b.startedAt - a.startedAt));
  }

  async getReport(reportId: string): Promise<ResearchReport | undefined> {
    await this.ready;
    return this.options.repository.getReport(reportId);
  }

  async listReports(symbol?: string): Promise<ResearchReport[]> {
    await this.ready;
    if (symbol) return this.options.repository.listBySymbol(symbol.trim().toUpperCase());
    const summaries = await this.options.repository.listSummaries();
    const reports = await Promise.all(summaries.map((s) => this.options.repository.getReport(s.id)));
    return reports.filter((r): r is ResearchReport => r !== undefined);
  }

  private assertInactive(symbol: string): void {
    if (this.active.has(symbol)) throw createCodeError('RESEARCH_RUN_ACTIVE', 'A research run for this symbol is already active.');
  }

  private async persist(cp: ResearchCheckpoint): Promise<void> {
    if (this.active.get(cp.summary.symbol)?.controller.signal.aborted) {
      cp.summary = { ...cp.summary, status: 'cancelled', cancelled: true, recoverable: false, finishedAt: this.now() };
    }
    await this.options.repository.saveCheckpoint(cp);
    await this.options.repository.saveRunSummary(cp.summary);
    this.memory.set(cp.summary.id, structuredClone(cp.summary));
  }

  private launch(cp: ResearchCheckpoint): void {
    const active: ActiveRun = { runId: cp.summary.id, controller: new AbortController() };
    this.active.set(cp.summary.symbol, active);
    active.done = this.execute(cp, active).finally(() => this.active.delete(cp.summary.symbol));
    void active.done.catch(() => undefined);
  }

  private async execute(cp: ResearchCheckpoint, active: ActiveRun): Promise<void> {
    try {
      const result = await this.runner.run({
        runId: cp.summary.id, symbol: cp.summary.symbol, strategyId: cp.summary.strategyId,
        locale: cp.summary.locale, signal: active.controller.signal, checkpoint: cp,
        onCheckpoint: (snapshot) => this.persist(snapshot),
        beforeSynthesis: async () => {
          if (JSON.stringify(await this.identity()) !== JSON.stringify(cp.identity)) {
            throw createCodeError('RESEARCH_IDENTITY_CHANGED', 'Provider/model/config changed while fetching. Restore it before resuming.');
          }
        },
      });
      if (result.report && !active.controller.signal.aborted) {
        // Preserve #73: never publish a completed/partial summary before its report.
        await this.options.repository.saveReport(result.report);
        await this.options.onReport?.(result.report);
        cp.summary = { ...cp.summary, status: result.report.runStatus,
          reportId: result.report.id, finishedAt: this.now(), recoverable: false };
        cp.events.push({ runId: cp.summary.id, parentRunId: cp.summary.id, spanId: randomUUID(), type: 'published', at: this.now() });
      } else {
        cp.summary = result.summary;
      }
      cp.budget.usage.wallClockMs = this.now() - cp.summary.startedAt;
      await this.persist(cp);
      try {
        // The runner's checkpoint result is pre-publication; export the committed status.
        await this.options.onRunComplete?.({ ...result, summary: structuredClone(cp.summary) });
      } catch {
        // Telemetry failures must not change a successfully persisted terminal state.
      }
    } catch (error) {
      // Reload the last committed checkpoint, not uncommitted worker memory.
      try {
        const saved = await this.options.repository.getCheckpoint(cp.summary.id);
        if (!saved) throw error;
        saved.summary = { ...saved.summary, status: 'interrupted', recoverable: true,
          error: redact(error instanceof Error ? error.message : String(error)) };
        await this.persist(saved);
      } catch (storageError) {
        // A disk outage must not leave the renderer polling a dead worker forever.
        // Do not claim this diagnostic was persisted; startup reads the last good file.
        const previous = this.memory.get(cp.summary.id) ?? cp.summary;
        this.memory.set(cp.summary.id, { ...previous, status: 'failed', recoverable: false,
          error: 'Recovery state could not be saved: ' + redact(storageError instanceof Error ? storageError.message : String(storageError)) });
      }
    }
  }

  private async reconcile(): Promise<void> {
    const repository = this.options.repository;
    let summaries: ResearchRunSummary[] = [];
    try {
      const loaded = await repository.listRunSummaries();
      if (Array.isArray(loaded)) summaries = loaded.filter((s) => s && typeof s.id === 'string' &&
        typeof s.symbol === 'string' && typeof s.status === 'string' && Number.isFinite(s.startedAt) &&
        Array.isArray(s.plannedCapabilities) && Array.isArray(s.completedCapabilities) && Array.isArray(s.failedCapabilities));
    }
    catch { /* Independently discoverable checkpoints remain authoritative. */ }
    for (const summary of summaries) this.memory.set(summary.id, summary);
    for (const runId of await repository.listCheckpointIds()) {
      try {
        const cp = await repository.getCheckpoint(runId);
        if (!cp) continue;
        // The durable payload can also repair a missing report/index projection.
        if (SETTLED_RESEARCH_STATUSES.has(cp.summary.status) && cp.report && cp.summary.reportId) {
          await repository.saveReport(cp.report);
        }
        this.memory.set(runId, cp.summary);
        if (!SETTLED_RESEARCH_STATUSES.has(cp.summary.status)) {
          cp.summary = { ...cp.summary, status: 'interrupted', recoverable: true };
          cp.events.push({ runId, parentRunId: runId, spanId: randomUUID(), type: 'interrupted', at: this.now() });
          await repository.saveCheckpoint(cp);
          this.memory.set(runId, cp.summary);
        }
      } catch (error) {
        const old = this.memory.get(runId);
        if (old?.status === 'cancelled') continue;
        this.memory.set(runId, {
          id: runId, symbol: old?.symbol ?? 'Unknown', startedAt: old?.startedAt ?? this.now(),
          ...old, status: 'failed', recoverable: false,
          plannedCapabilities: old?.plannedCapabilities ?? [], completedCapabilities: old?.completedCapabilities ?? [],
          failedCapabilities: old?.failedCapabilities ?? [],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    for (const summary of this.memory.values()) {
      if (!SETTLED_RESEARCH_STATUSES.has(summary.status) && summary.status !== 'interrupted') {
        summary.status = 'interrupted';
        summary.recoverable = false;
        summary.error = 'Legacy run has no durable checkpoint. Restart or discard it.';
      }
    }
    await repository.replaceRunSummaries([...this.memory.values()]);
  }
}
