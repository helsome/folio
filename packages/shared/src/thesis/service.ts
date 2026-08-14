import type {
  CapabilityRegistry,
  EvidenceRef,
  InvestmentThesis,
  ResearchReport,
  ThesisImpact,
  ThesisImpactEvaluator,
  ThesisImpactInput,
} from '@finagent/core';
import { CapabilityExecutor, type RunAllSpec, type RunOutcome } from '../capabilities/executor.ts';
import { createCodeError } from '../agent/errors.ts';
import type { ThesisImpactRepository, ThesisRepository } from './repository.ts';
import { reportToThesis } from './converter.ts';

/**
 * Fresh capabilities fetched to re-evaluate a thesis. Capabilities absent from
 * the registry are recorded as `unavailable` runs rather than silently dropped.
 */
const RE_EVALUATE_CAPABILITY_IDS = [
  'market.quote',
  'research.news',
  'company.ratings',
  'company.earnings',
  'company.financials',
  'company.valuation',
  'market.kline',
] as const;

const RUN_CONCURRENCY = 4;
const RUN_TIMEOUT_MS = 20_000;

export interface ThesisServiceOptions {
  registry: CapabilityRegistry;
  repository: ThesisRepository;
  impactRepository: ThesisImpactRepository;
  evaluator: ThesisImpactEvaluator;
  executor?: CapabilityExecutor;
  now?: () => number;
}

/**
 * Orchestrates the thesis lifecycle: create from a research report, re-evaluate
 * against fresh capability data, and persist the resulting impact + updated
 * thesis snapshot.
 */
export class ThesisService {
  private readonly registry: CapabilityRegistry;
  private readonly repository: ThesisRepository;
  private readonly impactRepository: ThesisImpactRepository;
  private readonly evaluator: ThesisImpactEvaluator;
  private readonly executor: CapabilityExecutor;
  private readonly now: () => number;

  constructor(options: ThesisServiceOptions) {
    this.registry = options.registry;
    this.repository = options.repository;
    this.impactRepository = options.impactRepository;
    this.evaluator = options.evaluator;
    this.executor = options.executor ?? new CapabilityExecutor({ now: options.now });
    this.now = options.now ?? Date.now;
  }

  /** Convert a completed ResearchReport into a persisted InvestmentThesis. */
  async saveFromReport(report: ResearchReport): Promise<InvestmentThesis> {
    const thesis = reportToThesis(report, this.repository.idGen, this.now);
    return this.repository.save(thesis);
  }

  /**
   * Re-evaluate the latest thesis for a symbol: fetch fresh data, ask the
   * evaluator for a verdict, persist the impact and the updated thesis snapshot.
   */
  async reEvaluate(symbol: string, trigger?: ThesisImpactInput['trigger']): Promise<ThesisImpact> {
    const thesis = await this.latestThesis(symbol);
    if (!thesis) {
      throw createCodeError('THESIS_NOT_FOUND', `No thesis exists for symbol "${symbol}".`);
    }

    const outcomes = await this.fetchFresh(symbol);

    const input: ThesisImpactInput = {
      thesis,
      trigger,
      dataBundle: buildDataBundle(outcomes),
      runs: outcomes.map((outcome) => ({
        capabilityId: outcome.record.capabilityId,
        status: outcome.record.status,
        summary: outcome.result?.summary,
        error: outcome.record.error,
      })),
    };

    const { kind, summary, updatedThesis } = await this.evaluator.evaluate(input);

    const evidence = buildEvidence(outcomes, this.now());
    const snapshot: InvestmentThesis = {
      ...updatedThesis,
      updatedAt: this.now(),
      lastReviewedAt: this.now(),
      evidenceRefs: evidence,
    };

    const impact: ThesisImpact = {
      id: this.impactRepository.idGen(),
      thesisId: thesis.id,
      symbol,
      evaluatedAt: this.now(),
      kind,
      summary,
      trigger,
      evidence,
      thesis: snapshot,
    };

    await this.impactRepository.append(impact);
    await this.repository.save(snapshot);

    return impact;
  }

  /** Persist a user-edited thesis, bumping `updatedAt`. */
  async updateThesis(userEdited: InvestmentThesis): Promise<InvestmentThesis> {
    return this.repository.save({ ...userEdited, updatedAt: this.now() });
  }

  /** Impact history for a symbol (all theses), most-recent first. */
  async listImpacts(symbol: string): Promise<ThesisImpact[]> {
    const theses = await this.repository.getBySymbol(symbol);
    const impacts: ThesisImpact[] = [];
    for (const thesis of theses) {
      impacts.push(...(await this.impactRepository.list(thesis.id)));
    }
    return impacts.sort((a, b) => b.evaluatedAt - a.evaluatedAt);
  }

  private async latestThesis(symbol: string): Promise<InvestmentThesis | undefined> {
    const theses = await this.repository.getBySymbol(symbol);
    return theses[0];
  }

  private async fetchFresh(symbol: string): Promise<RunOutcome[]> {
    const specs: RunAllSpec[] = [];
    const unavailable: RunOutcome[] = [];

    for (const id of RE_EVALUATE_CAPABILITY_IDS) {
      const cap = this.registry.get(id);
      if (!cap) {
        unavailable.push(unavailableOutcome(id, this.now));
        continue;
      }
      specs.push({ cap, input: { symbol } });
    }

    const outcomes = await this.executor.runAll(specs, {
      concurrency: RUN_CONCURRENCY,
      timeoutMs: RUN_TIMEOUT_MS,
    });

    return [...outcomes, ...unavailable];
  }
}

function unavailableOutcome(capabilityId: string, now: () => number): RunOutcome {
  const timestamp = now();
  return {
    record: {
      id: `run-${capabilityId}-${timestamp}-unavailable`,
      capabilityId,
      startedAt: timestamp,
      finishedAt: timestamp,
      durationMs: 0,
      status: 'unavailable',
      error: `Capability ${capabilityId} is not registered.`,
    },
  };
}

function buildDataBundle(outcomes: RunOutcome[]): string {
  const bundle: Record<string, unknown> = {};
  for (const outcome of outcomes) {
    if (outcome.result) bundle[outcome.record.capabilityId] = outcome.result.data;
  }
  return JSON.stringify(bundle);
}

function buildEvidence(outcomes: RunOutcome[], now: number): EvidenceRef[] {
  const evidence: EvidenceRef[] = [];
  for (const outcome of outcomes) {
    if (outcome.record.status !== 'success' || !outcome.result) continue;
    evidence.push({
      capabilityId: outcome.record.capabilityId,
      runId: outcome.record.id,
      claim: `Fresh ${outcome.record.capabilityId} data`,
      fetchedAt: outcome.result.provenance.fetchedAt ?? now,
      summary: outcome.result.summary,
    });
  }
  return evidence;
}
