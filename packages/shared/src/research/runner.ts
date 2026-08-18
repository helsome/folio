import type {
  CapabilityRunStatus,
  CapabilityRunSummary,
  EvidenceRef,
  ResearchReport,
  ResearchRunStatus,
  ResearchRunSummary,
  ResearchSection,
  ResearchSynthesis,
  ResearchSynthesizer,
  StrategyId,
} from '@finagent/core';
import { i18nCurrentLocale } from '@finagent/i18n';
import type { SupportedLocale } from '@finagent/core';
import type { CapabilityRegistry } from '@finagent/core';
import { CapabilityExecutor, type RunOutcome } from '../capabilities/index.ts';
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
 * Capabilities are fetched in parallel via `CapabilityExecutor.runAll`
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
    const startedAt = this.now();
    const plan = planForStrategy(request.strategyId, this.registry);
    const plannedIds = plan.map((p) => p.capabilityId);

    const base = {
      id: runId,
      symbol,
      startedAt,
      plannedCapabilities: plannedIds,
      completedCapabilities: [] as string[],
      failedCapabilities: [] as string[],
    };

    const emit = async (status: ResearchRunStatus, extra?: Partial<ResearchRunSummary>) => {
      const summary: ResearchRunSummary = { ...base, status, ...extra };
      await request.onStatus?.(summary);
      return summary;
    };

    await emit('fetching');

    const specs = plan
      .filter((p) => p.available)
      .map((p) => ({
        cap: this.registry.get(p.capabilityId)!,
        input: buildCapabilityInput(p.capabilityId, symbol),
      }));

    const outcomes = await this.executor.runAll(specs, {
      concurrency: CONCURRENCY,
      timeoutMs: TIMEOUT_MS,
      signal,
    });

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
      synthesis = await this.synthesizer.synthesize(
        { symbol, plannedCapabilities: plannedIds, runs, dataBundle },
        signal
      );
    } catch (error) {
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
      bundle[outcome.record.capabilityId] = truncateData(
        outcome.record.capabilityId,
        outcome.result.data
      );
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

  const sections: ResearchSection[] = synthesis.sections.map((section) => {
    const outcome = outcomeByCapability.get(section.key);
    const evidence: EvidenceRef[] = [];
    if (outcome && outcome.record.status === 'success') {
      evidence.push({
        capabilityId: outcome.record.capabilityId,
        runId: outcome.record.id,
        claim: section.summary,
        fetchedAt: outcome.record.provenance?.fetchedAt ?? generatedAt,
        summary: outcome.result?.summary,
      });
    }
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

  return {
    id: `report-${runId}`,
    symbol,
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
    runStatus: computeRunStatus(plan, successIds),
  };
}
