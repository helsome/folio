import {
  readInstrumentId,
  type CapabilityRunStatus,
  type CapabilityRunSummary,
  type EvidenceRef,
  type ResearchClaim,
  type ResearchReport,
  type ResearchRunStatus,
  type ResearchRunSummary,
  type ResearchSection,
  type ResearchSynthesis,
  type ResearchSynthesizer,
  type StrategyId,
} from '@finagent/core';
import { i18nCurrentLocale } from '@finagent/i18n';
import { randomUUID } from 'node:crypto';
import { addUsage, checkBudget } from '../kernel/run-budget.ts';
import { createCodeError } from '../agent/errors.ts';
import type { ResearchCheckpoint } from './checkpoint.ts';
import type { SupportedLocale } from '@finagent/core';
import type { CapabilityRegistry } from '@finagent/core';
import { CapabilityExecutor, type RunOutcome } from '../capabilities/index.ts';
import { claimIdOf, evidenceIdOf } from './claim-evidence.ts';
import {
  buildCapabilityInput,
  planForStrategy,
  type PlannedCapability,
} from './planner.ts';

const CONCURRENCY = 4;
const TIMEOUT_MS = 20000;

export interface ResearchRunnerOptions {
  registry: CapabilityRegistry;
  synthesizer: ResearchSynthesizer;
  executor?: CapabilityExecutor;
  now?: () => number;
}

export interface ResearchRunRequest {
  checkpoint?: ResearchCheckpoint;
  onCheckpoint?: (checkpoint: ResearchCheckpoint) => Promise<void>;
  beforeSynthesis?: () => Promise<void>;
  symbol: string;
  runId: string;
  /** V5: research strategy whose plan drives this run (optional, legacy plan otherwise). */
  strategyId?: StrategyId;
  signal?: AbortSignal;
  onStatus?: (summary: ResearchRunSummary) => void | Promise<void>;
  /** V8: preferred response/UI locale for the report (overrides ambient). */
  locale?: SupportedLocale;
}

export interface ResearchRunResult {
  summary: ResearchRunSummary;
  report?: ResearchReport;
}

/**
 * Orchestrates a single Deep Research run:
 *
 *   queued → fetching → synthesizing → completed | partial | failed | cancelled
 *
 * Capabilities are fetched by bounded workers via `CapabilityExecutor.run`
 * (concurrency 4, 20s timeout, abort-aware). The injected synthesizer turns
 * the structured data bundle into analysis; evidence refs are attached from
 * the real `CapabilityRunRecord` ids so prose is never the source of truth.
 */
export class ResearchRunner {
  private readonly registry: CapabilityRegistry;
  private readonly synthesizer: ResearchSynthesizer;
  private readonly executor: CapabilityExecutor;
  private readonly now: () => number;

  constructor(options: ResearchRunnerOptions) {
    this.registry = options.registry;
    this.synthesizer = options.synthesizer;
    this.now = options.now ?? Date.now;
    this.executor = options.executor ?? new CapabilityExecutor({ now: this.now });
  }

  async run(request: ResearchRunRequest): Promise<ResearchRunResult> {
    const { symbol, runId, signal } = request;
    const cp = request.checkpoint;
    const startedAt = cp?.summary.startedAt ?? this.now();
    const plan = cp?.plan ?? planForStrategy(request.strategyId, this.registry);
    const plannedIds = plan.map((p) => p.capabilityId);

    const base = {
      id: runId,
      symbol,
      startedAt,
      plannedCapabilities: plannedIds,
      completedCapabilities: [] as string[],
      failedCapabilities: [] as string[],
    };

    let checkpointWrites = Promise.resolve();
    const checkpoint = (mutate: () => void): Promise<void> => {
      const next = checkpointWrites.then(async () => {
        mutate();
        if (cp) await request.onCheckpoint?.(structuredClone(cp));
      });
      checkpointWrites = next.catch(() => undefined);
      return next;
    };
    const charge = (kind: 'toolCalls' | 'modelCalls', stepId?: string) => checkpoint(() => {
      if (!cp) return;
      cp.budget.usage.wallClockMs = this.now() - startedAt;
      const exhausted = checkBudget(cp.budget.limits, cp.budget.usage);
      if (exhausted) throw createCodeError('RESEARCH_BUDGET_EXHAUSTED', 'Research budget exhausted: ' + exhausted.key);
      cp.budget.usage = addUsage(cp.budget.usage, {
        [kind]: 1, ...(stepId?.startsWith('research.') ? { searchIterations: 1 } : {}),
      });
      if (stepId) {
        cp.retry.attempts[stepId] = (cp.retry.attempts[stepId] ?? 0) + 1;
        cp.inFlight = [...new Set([...cp.inFlight, stepId])];
      } else {
        cp.retry.synthesisAttempts += 1;
      }
    });
    const emit = async (status: ResearchRunStatus, extra?: Partial<ResearchRunSummary>) => {
      const summary: ResearchRunSummary = { ...base, ...cp?.summary, status, ...extra };
      await checkpoint(() => { if (cp) cp.summary = summary; });
      await request.onStatus?.(summary);
      return summary;
    };

    // Publication is an idempotent replay of a saved report, never new synthesis.
    if (cp?.report) return { summary: cp.summary, report: cp.report };

    await emit('fetching');

    const specs = plan
      .filter((p) => p.available && !cp?.outcomes.some((o) => o.record.capabilityId === p.capabilityId))
      .map((p) => {
        const cap = this.registry.get(p.capabilityId);
        if (!cap || cap.riskLevel !== 'read') {
          throw createCodeError('RESEARCH_CAPABILITY_UNSAFE', 'Research requires a registered read-only capability: ' + p.capabilityId);
        }
        return { cap, input: 'input' in p ? p.input : buildCapabilityInput(p.capabilityId, symbol) };
      });
    const outcomes: RunOutcome[] = [...(cp?.outcomes ?? [])];
    let next = 0;
    let workerError: unknown;
    const workers = Array.from({ length: Math.min(CONCURRENCY, specs.length) }, async () => {
      while (next < specs.length && !signal?.aborted && !workerError) {
        const spec = specs[next++];
        try {
          await charge('toolCalls', spec.cap.id);
          const outcome = await this.executor.run(spec.cap, spec.input, { timeoutMs: TIMEOUT_MS, signal });
          outcomes.push(outcome);
          await checkpoint(() => {
            if (!cp) return;
            cp.outcomes.push(outcome);
            cp.inFlight = cp.inFlight.filter((id) => id !== spec.cap.id);
            cp.summary.completedCapabilities = cp.outcomes.filter((o) => o.record.status === 'success').map((o) => o.record.capabilityId);
            cp.summary.failedCapabilities = cp.outcomes.filter((o) => o.record.status !== 'success').map((o) => o.record.capabilityId);
            cp.events.push({ runId, parentRunId: runId, spanId: randomUUID(), type: 'step', stepId: spec.cap.id, at: this.now() });
          });
        } catch (error) { workerError = error; }
      }
    });
    await Promise.allSettled(workers);
    if (workerError) throw workerError;

    const successIds = outcomes
      .filter((o) => o.record.status === 'success')
      .map((o) => o.record.capabilityId);
    const failedIds = plannedIds.filter((id) => !successIds.includes(id));

    if (signal?.aborted) {
      const summary = await emit('cancelled', {
        finishedAt: this.now(),
        cancelled: true,
        completedCapabilities: successIds,
        failedCapabilities: failedIds,
      });
      return { summary };
    }

    await emit('synthesizing', {
      completedCapabilities: successIds,
      failedCapabilities: failedIds,
    });

    const runs = buildRuns(plan, outcomes);
    const dataBundle = buildDataBundle(outcomes);

    let synthesis: ResearchSynthesis;
    try {
      if (cp) await checkpoint(() => { cp.phase = 'synthesizing'; });
      if (!cp?.synthesis) await request.beforeSynthesis?.();
      if (!cp?.synthesis) await charge('modelCalls');
      synthesis = cp?.synthesis ?? await this.synthesizer.synthesize(
        { symbol, plannedCapabilities: plannedIds, runs, dataBundle,
          ...(cp ? { recovery: {
            runId, attempt: cp.retry.synthesisAttempts,
            onAgentRun: (agentRunId: string, sessionId: string) => checkpoint(() => {
              cp.events.push({ runId, parentRunId: runId, spanId: randomUUID(), type: 'synthesis',
                at: this.now(), agentRunId, sessionId });
            }),
          } } : {}),
        },
        signal
      );
      // A section key identifies one report dimension; never append duplicates.
      synthesis = { ...synthesis, sections: [...new Map(synthesis.sections.map((section) => [section.key, section])).values()] };
      if (signal?.aborted) throw createCodeError('RESEARCH_CANCELLED', 'Research cancelled.');
      await checkpoint(() => { if (cp) cp.synthesis = synthesis; });
    } catch (error) {
      if (cp && !signal?.aborted) throw error;
      if (signal?.aborted) {
        const summary = await emit('cancelled', {
          finishedAt: this.now(),
          cancelled: true,
          failedCapabilities: plannedIds,
        });
        return { summary };
      }
      const summary = await emit('failed', {
        finishedAt: this.now(),
        failedCapabilities: plannedIds,
        error: error instanceof Error ? error.message : String(error),
      });
      return { summary };
    }

    const report = assembleReport({
      runId,
      symbol,
      strategyId: request.strategyId,
      generatedAt: this.now(),
      plan,
      outcomes,
      synthesis,
      locale: request.locale,
    });

    if (cp) {
      await checkpoint(() => {
        cp.report = report;
        cp.phase = 'publishing';
      });
      // Service publishes report and derived records before committing terminal status.
      return { summary: cp.summary, report };
    }
    const summary = await emit(computeRunStatus(plan, successIds), {
      finishedAt: this.now(),
      reportId: report.id,
      completedCapabilities: successIds,
      failedCapabilities: failedIds,
    });
    return { summary, report };
  }
}

function buildRuns(plan: PlannedCapability[], outcomes: RunOutcome[]) {
  const byCapability = new Map(outcomes.map((o) => [o.record.capabilityId, o]));
  return plan.map((p) => {
    const outcome = byCapability.get(p.capabilityId);
    if (!outcome) {
      return { capabilityId: p.capabilityId, status: 'unavailable' as CapabilityRunStatus };
    }
    return {
      capabilityId: outcome.record.capabilityId,
      status: outcome.record.status,
      summary: outcome.result?.summary,
      provenance: outcome.result?.provenance,
      error: outcome.record.error,
    };
  });
}

function buildDataBundle(outcomes: RunOutcome[]): string {
  const bundle: Record<string, unknown> = {};
  for (const outcome of outcomes) {
    if (outcome.record.status === 'success' && outcome.result) {
      const data = truncateData(outcome.record.capabilityId, outcome.result.data);
      // Security: external-text capabilities (news) are labeled untrusted so
      // the synthesizer treats their prose as attributed claims, never
      // instructions. Text was already sanitized at the capability boundary.
      bundle[outcome.record.capabilityId] = outcome.record.capabilityId === 'research.news'
        ? { trust: 'untrusted', provider: outcome.result.provenance?.provider ?? 'unknown', items: data }
        : data;
    }
  }
  return JSON.stringify(bundle);
}

function truncateData(capabilityId: string, data: unknown): unknown {
  if (!Array.isArray(data)) return data;
  if (capabilityId === 'market.kline' || capabilityId === 'market.intraday') {
    return data.slice(-60);
  }
  if (capabilityId === 'research.news') {
    return data.slice(0, 10);
  }
  return data;
}

function computeRunStatus(plan: PlannedCapability[], successIds: string[]): ResearchRunStatus {
  const allSucceeded = plan.every((p) => successIds.includes(p.capabilityId));
  if (allSucceeded) return 'completed';
  if (successIds.length > 0) return 'partial';
  return 'failed';
}

function assembleReport(args: {
  runId: string;
  symbol: string;
  strategyId?: string;
  generatedAt: number;
  plan: PlannedCapability[];
  outcomes: RunOutcome[];
  synthesis: ResearchSynthesis;
  locale?: SupportedLocale;
}): ResearchReport {
  const { runId, symbol, strategyId, generatedAt, plan, outcomes, synthesis, locale } = args;

  const outcomeByCapability = new Map(outcomes.map((o) => [o.record.capabilityId, o]));
  const claims: ResearchClaim[] = [];

  const sections: ResearchSection[] = synthesis.sections.map((section) => {
    const outcome = outcomeByCapability.get(section.key);
    const usable = outcome && outcome.record.status === 'success' ? outcome : undefined;
    const claimId = claimIdOf(section.key, 0);
    const evidenceId = usable
      ? evidenceIdOf(usable.record.id, usable.record.capabilityId)
      : undefined;

    const evidence: EvidenceRef[] = [];
    if (usable) {
      const instrumentId =
        usable.result?.provenance?.instrumentId ?? readInstrumentId(usable.result?.data);
      evidence.push({
        id: evidenceId,
        capabilityId: usable.record.capabilityId,
        runId: usable.record.id,
        claim: section.summary,
        claimId,
        fetchedAt: usable.record.provenance?.fetchedAt ?? generatedAt,
        summary: usable.result?.summary,
        ...(instrumentId ? { instrumentId } : {}),
      });
    }

    // Every section contributes one claim today; the id plus list shape already
    // supports several per section. A section whose capability failed keeps its
    // claim with no evidence behind it — visible as an unbacked edge rather
    // than silently dropped.
    claims.push({
      id: claimId,
      sectionKey: section.key,
      text: section.summary,
      evidenceRefs: evidenceId ? [evidenceId] : [],
    });

    return { ...section, evidence };
  });

  const capabilityRuns = plan.map((p): CapabilityRunSummary => {
    const outcome = outcomeByCapability.get(p.capabilityId);
    if (!outcome) {
      return {
        runId: `missing:${p.capabilityId}`,
        capabilityId: p.capabilityId,
        status: 'unavailable',
        error: 'Capability not registered',
      };
    }
    const record = outcome.record;
    return {
      runId: record.id,
      capabilityId: record.capabilityId,
      status: record.status,
      fetchedAt: record.provenance?.fetchedAt,
      marketTime: record.provenance?.marketTime,
      error: record.error,
    };
  });

  const successIds = outcomes
    .filter((o) => o.record.status === 'success')
    .map((o) => o.record.capabilityId);

  const instrumentId = outcomes
    .map((outcome) => outcome.result?.provenance?.instrumentId ?? readInstrumentId(outcome.result?.data))
    .find((id): id is string => typeof id === 'string' && id.length > 0);

  return {
    id: `report-${runId}`,
    symbol,
    ...(instrumentId ? { instrumentId } : {}),
    ...(strategyId ? { strategyId } : {}),
    generatedAt,
    // Stamp the generating locale so the report records which language produced
    // it (V8 §44–46). The run's explicit locale wins; legacy/tests fall back to
    // the ambient UI locale; legacy stored reports omit the field entirely and
    // their prose is never translated either way.
    locale: locale ?? i18nCurrentLocale(),
    summary: synthesis.summary,
    stance: synthesis.stance,
    confidence: synthesis.confidence,
    sections,
    bullCase: synthesis.bullCase,
    bearCase: synthesis.bearCase,
    catalysts: synthesis.catalysts,
    risks: synthesis.risks,
    capabilityRuns,
    // Claim ↔ evidence identity travels with the report, so the links are the
    // same after persistence, reload and export (issue #13).
    claims,
    runStatus: computeRunStatus(plan, successIds),
  };
}
