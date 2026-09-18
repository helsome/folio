// Folio V7 — Agent Engineering Evaluation domain types.
//
// These types are the shared contract between:
//   - the benchmark dataset (EvaluationCase / EvaluationDataset)
//   - deterministic evaluators and LLM judges (EvaluationScore / EvaluationFailureMode)
//   - the experiment runner (EvaluationExperiment / ExperimentSummary)
//   - regression gates (EvaluationBaseline / RegressionResult)
//   - trace correlation (TraceReference)
//   - observability settings (EvaluationSettings / PrivacyLevel)
//
// Layer scope (spec §3): this file covers Layer 1 (agent engineering) and the
// accounting for Layer 2 (financial research) and Layer 3 (investment outcome)
// linkage. It does not replace the existing outcome/calibration domain.

import type { ApiError, ToolCallRecord, SupportedLocale, WorkspaceContext } from './index.ts';

// ── Benchmark cases ─────────────────────────────────────────────────────────

export type EvaluationCategory =
  | 'market'
  | 'research'
  | 'tool-selection'
  | 'tool-arguments'
  | 'grounded'
  | 'strategy'
  | 'provider-failure'
  | 'portfolio'
  | 'compare'
  | 'long-tail'
  | 'adversarial';

/** Difficulty tags drive release gates: regression cases weigh most (spec §26). */
export type EvaluationDifficulty =
  | 'golden'
  | 'difficult'
  | 'long_tail'
  | 'tool_failure'
  | 'regression'
  | 'adversarial';

/** Where a case came from — trace mining requires privacy cleanup (spec §24). */
export type EvaluationCaseSource =
  | 'hand-authored'
  | 'real-trace'
  | 'regression-bug'
  | 'provider-fixture'
  | 'historical-issue';

/** Input surface for a single agent run under evaluation (spec §19). */
export interface EvaluationCaseInput {
  prompt: string;
  workspaceContext?: WorkspaceContext;
  strategyId?: string;
  /** Optional model override (e.g. "anthropic/claude-sonnet-4-5"); default = experiment model. */
  model?: string;
  /** Optional provider override. */
  provider?: string;
  /** Optional fixture/seed configuration for deterministic mode. */
  fixture?: Record<string, unknown>;
}

/**
 * Expected *behavior*, not just an expected answer string (spec §20).
 * Benchmark evaluation targets what the agent did, which tools it used,
 * whether it stayed grounded, and how it handled failure.
 */
export interface EvaluationExpectations {
  requiredCapabilities?: string[];
  optionalCapabilities?: string[];
  forbiddenCapabilities?: string[];
  maxToolCalls?: number;
  mustHaveEvidence?: boolean;
  /** Research dimensions the answer should cover (valuation, growth, risk…). */
  requiredResearchDimensions?: string[];
  expectedFailureMode?: EvaluationFailureMode;
  expectedStance?: 'bullish' | 'bearish' | 'neutral';
  allowedProviders?: string[];
  /** Maximum acceptable data age in ms when freshness compliance is evaluated. */
  freshnessRequirementMs?: number;
  /** Key facts/claims a correct answer must contain (LLM judge input). */
  expectedAnswerHint?: string;
  /** Optional full golden answer text for reference. */
  expectedAnswer?: string;
}

export interface EvaluationCase {
  id: string;
  name: string;
  category: EvaluationCategory;
  difficulty: EvaluationDifficulty;
  input: EvaluationCaseInput;
  expected: EvaluationExpectations;
  tags: string[];
  source: EvaluationCaseSource;
  /**
   * Runtime locale for this case (spec §37–38). The Eval Runner drives the
   * agent's response language from the case/experiment, NOT the user's UI
   * locale. Defaults to 'en-US' for older cases so benchmark reproducibility
   * is preserved. Does not change stored user content or historical reports.
   */
  locale?: SupportedLocale;
}

export interface EvaluationDataset {
  /** Stable id, e.g. "folio-agent-v1". */
  id: string;
  /** Semantic version; bump on any case change so experiments stay comparable (spec §25). */
  version: string;
  name: string;
  description?: string;
  createdAt: number;
  cases: EvaluationCase[];
}

/** A source/evidence expectation for a research Gold Case. */
export interface EvaluationEvidenceRequirement {
  /** Whether every material claim must carry a citation/evidence reference. */
  mustCite: boolean;
  /** Minimum number of independent sources required when applicable. */
  minSources?: number;
  /** Allowed source classes, e.g. filing, company-ir, or news. */
  sourceKinds?: string[];
}

/** Weighted, machine-readable rubric for a research Gold Case. */
export interface EvaluationRubric {
  criteria: Record<string, { description: string; weight: number }>;
  /** Minimum weighted score in the normalized 0..1 range. */
  passThreshold: number;
}

/**
 * Versioned Deep Research case contract.
 *
 * This deliberately extends the existing agent case instead of replacing it,
 * so the regular benchmark runner can execute Gold Cases unchanged while
 * research-specific evaluators can consume the richer expectations.
 */
export interface EvaluationGoldCase extends EvaluationCase {
  schemaVersion: 'gold-case/v1';
  expectedFacts: string[];
  expectedSources?: string[];
  evidenceRequirements: EvaluationEvidenceRequirement;
  forbiddenConditions: string[];
  rubric: EvaluationRubric;
}

export interface EvaluationGoldDataset extends Omit<EvaluationDataset, 'cases'> {
  schemaVersion: 'gold-case/v1';
  cases: EvaluationGoldCase[];
}

export interface GoldCaseValidationIssue {
  path: string;
  message: string;
}

/** Deterministically validate a versioned Gold Case dataset before execution. */
export function validateGoldCaseDataset(
  dataset: EvaluationGoldDataset,
): GoldCaseValidationIssue[] {
  const issues: GoldCaseValidationIssue[] = [];
  if (dataset.schemaVersion !== 'gold-case/v1') {
    issues.push({ path: 'schemaVersion', message: 'must be gold-case/v1' });
  }
  if (!/^\d+\.\d+\.\d+$/.test(dataset.version)) {
    issues.push({ path: 'version', message: 'must be semantic version x.y.z' });
  }
  if (dataset.cases.length < 1) {
    issues.push({ path: 'cases', message: 'must contain at least one case' });
  }

  const ids = new Set<string>();
  for (const [index, caseItem] of dataset.cases.entries()) {
    const path = `cases[${index}]`;
    if (ids.has(caseItem.id)) issues.push({ path: `${path}.id`, message: 'must be unique' });
    ids.add(caseItem.id);
    if (caseItem.schemaVersion !== 'gold-case/v1') {
      issues.push({ path: `${path}.schemaVersion`, message: 'must be gold-case/v1' });
    }
    if (caseItem.expectedFacts.length === 0) {
      issues.push({ path: `${path}.expectedFacts`, message: 'must contain at least one fact' });
    }
    if (caseItem.forbiddenConditions.length === 0) {
      issues.push({ path: `${path}.forbiddenConditions`, message: 'must contain at least one condition' });
    }
    const requirement = caseItem.evidenceRequirements;
    if (requirement.minSources !== undefined && (!Number.isInteger(requirement.minSources) || requirement.minSources < 1)) {
      issues.push({ path: `${path}.evidenceRequirements.minSources`, message: 'must be a positive integer' });
    }
    const criteria = Object.entries(caseItem.rubric.criteria);
    if (criteria.length === 0) {
      issues.push({ path: `${path}.rubric.criteria`, message: 'must contain at least one criterion' });
    }
    const weightTotal = criteria.reduce((sum, [, criterion]) => sum + criterion.weight, 0);
    if (criteria.some(([, criterion]) => !Number.isFinite(criterion.weight) || criterion.weight <= 0)) {
      issues.push({ path: `${path}.rubric.criteria`, message: 'weights must be positive finite numbers' });
    } else if (Math.abs(weightTotal - 1) > 0.0001) {
      issues.push({ path: `${path}.rubric.criteria`, message: 'weights must sum to 1' });
    }
    if (!Number.isFinite(caseItem.rubric.passThreshold) || caseItem.rubric.passThreshold < 0 || caseItem.rubric.passThreshold > 1) {
      issues.push({ path: `${path}.rubric.passThreshold`, message: 'must be between 0 and 1' });
    }
  }
  return issues;
}

export function assertValidGoldCaseDataset(dataset: EvaluationGoldDataset): void {
  const issues = validateGoldCaseDataset(dataset);
  if (issues.length > 0) {
    throw new Error(issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '));
  }
}

// ── Failure taxonomy (spec §40-41) ──────────────────────────────────────────

export type EvaluationFailureMode =
  | 'wrong_tool'
  | 'missing_tool'
  | 'wrong_args'
  | 'tool_loop'
  | 'duplicate_tool'
  | 'ignored_tool_result'
  | 'provider_failure'
  | 'no_evidence'
  | 'unsupported_claim'
  | 'premature_answer'
  | 'context_miss'
  | 'strategy_miss'
  | 'timeout'
  | 'runtime_error'
  | 'judge_error'
  | 'resource_unavailable';

// ── Metrics & scores (spec §27, §110) ───────────────────────────────────────

export type EvaluationMetricId =
  | 'task_completion'
  | 'tool_recall'
  | 'tool_precision'
  | 'tool_error_rate'
  | 'argument_validity'
  | 'max_tool_calls'
  | 'evidence_presence'
  | 'provenance_presence'
  | 'freshness_compliance'
  | 'partial_failure_honesty'
  | 'latency'
  | 'failure_recovery'
  | 'groundedness'
  | 'research_completeness'
  | 'financial_reasoning'
  | 'decision_usefulness'
  | 'trajectory_quality';

export type EvaluationMetricKind = 'deterministic' | 'llm-judge' | 'trajectory' | 'outcome';

export interface EvaluationMetric {
  id: EvaluationMetricId;
  name: string;
  description?: string;
  /** Rubric/implementation version; rubrics must version so history stays comparable (spec §81). */
  version: string;
  kind: EvaluationMetricKind;
  higherIsBetter: boolean;
  /** Metrics whose regression fails the gate (spec §77). */
  critical: boolean;
  /** Default max |delta| for regression gating when a baseline does not override it. */
  defaultMaxDelta: number;
}

/** Evaluator registry content (spec §27): one metric definition per id. */
export const EVALUATION_METRICS: readonly EvaluationMetric[] = [
  {
    id: 'task_completion',
    name: 'Task Completion',
    version: '1.0.0',
    kind: 'deterministic',
    higherIsBetter: true,
    critical: true,
    defaultMaxDelta: 0.05,
  },
  {
    id: 'tool_recall',
    name: 'Required Tool Coverage',
    version: '1.0.0',
    kind: 'deterministic',
    higherIsBetter: true,
    critical: true,
    defaultMaxDelta: 0.05,
  },
  {
    id: 'tool_precision',
    name: 'Tool Precision',
    version: '1.0.0',
    kind: 'deterministic',
    higherIsBetter: true,
    critical: true,
    defaultMaxDelta: 0.05,
  },
  {
    id: 'tool_error_rate',
    name: 'Tool Error Rate',
    version: '1.0.0',
    kind: 'deterministic',
    higherIsBetter: false,
    critical: false,
    defaultMaxDelta: 0.05,
  },
  {
    id: 'argument_validity',
    name: 'Tool Argument Validity',
    version: '1.0.0',
    kind: 'deterministic',
    higherIsBetter: true,
    critical: true,
    defaultMaxDelta: 0.05,
  },
  {
    id: 'max_tool_calls',
    name: 'Maximum Tool Calls',
    version: '1.0.0',
    kind: 'deterministic',
    higherIsBetter: true,
    critical: false,
    defaultMaxDelta: 0.1,
  },
  {
    id: 'evidence_presence',
    name: 'Evidence Presence',
    version: '1.0.0',
    kind: 'deterministic',
    higherIsBetter: true,
    critical: true,
    defaultMaxDelta: 0.05,
  },
  {
    id: 'provenance_presence',
    name: 'Provenance Presence',
    version: '1.0.0',
    kind: 'deterministic',
    higherIsBetter: true,
    critical: false,
    defaultMaxDelta: 0.05,
  },
  {
    id: 'freshness_compliance',
    name: 'Freshness Compliance',
    version: '1.0.0',
    kind: 'deterministic',
    higherIsBetter: true,
    critical: false,
    defaultMaxDelta: 0.05,
  },
  {
    id: 'partial_failure_honesty',
    name: 'Partial Failure Honesty',
    version: '1.0.0',
    kind: 'deterministic',
    higherIsBetter: true,
    critical: false,
    defaultMaxDelta: 0.05,
  },
  {
    id: 'latency',
    name: 'Latency',
    version: '1.0.0',
    kind: 'deterministic',
    higherIsBetter: false,
    critical: false,
    defaultMaxDelta: 0.2,
  },
  {
    id: 'failure_recovery',
    name: 'Failure Recovery',
    version: '1.0.0',
    kind: 'deterministic',
    higherIsBetter: true,
    critical: true,
    defaultMaxDelta: 0.05,
  },
  {
    id: 'groundedness',
    name: 'Groundedness',
    version: '1.0.0',
    kind: 'llm-judge',
    higherIsBetter: true,
    critical: true,
    defaultMaxDelta: 0.05,
  },
  {
    id: 'research_completeness',
    name: 'Research Completeness',
    version: '1.0.0',
    kind: 'llm-judge',
    higherIsBetter: true,
    critical: false,
    defaultMaxDelta: 0.05,
  },
  {
    id: 'financial_reasoning',
    name: 'Financial Reasoning Quality',
    version: '1.0.0',
    kind: 'llm-judge',
    higherIsBetter: true,
    critical: false,
    defaultMaxDelta: 0.05,
  },
  {
    id: 'decision_usefulness',
    name: 'Decision Usefulness',
    version: '1.0.0',
    kind: 'llm-judge',
    higherIsBetter: true,
    critical: false,
    defaultMaxDelta: 0.05,
  },
  {
    id: 'trajectory_quality',
    name: 'Trajectory Quality',
    version: '1.0.0',
    kind: 'trajectory',
    higherIsBetter: true,
    critical: false,
    defaultMaxDelta: 0.05,
  },
] as const;

export type EvaluationScoreMap = Partial<Record<EvaluationMetricId, number | null>>;

export interface EvaluationScore {
  metric: EvaluationMetricId;
  metricVersion: string;
  /** Normalized 0..1, or null when the metric was not applicable (e.g. no judge). */
  score: number | null;
  /** Raw measured value where meaningful (seconds, tool count, error count). */
  value?: number;
  unit?: string;
  reason?: string;
  detail?: unknown;
}

// ── Runs, results, artifacts (spec §42-43) ─────────────────────────────────

export type EvaluationRunStatus = 'completed' | 'failed' | 'cancelled' | 'timeout' | 'skipped';

/**
 * A requested experiment-config dimension that has NO runtime control surface
 * and was therefore NOT applied (#114). Recorded explicitly — never silently
 * dropped, and never presented as if it were in effect.
 */
export interface UnappliedConfigItem {
  key: 'model' | 'provider' | 'thinkingLevel' | 'strategyId';
  reason: string;
}

/**
 * Runtime configuration confirmed by READBACK after application (#114).
 * Only values observed from the runtime's own state land here; a requested
 * value without readback proof never masquerades as effective. Runs recorded
 * before #114 simply omit this field (historical unknown — never backfilled).
 */
export interface EffectiveRuntimeConfig {
  model?: string;
  provider?: string;
  thinkingLevel?: string;
  /** Requested dimensions that could not be applied, with the reason why. */
  unapplied?: UnappliedConfigItem[];
  /** Epoch ms of the runtime readback that confirmed these values. */
  confirmedAt: number;
}

export interface EvaluationRun {
  id: string;
  experimentId: string;
  caseId: string;
  datasetId: string;
  status: EvaluationRunStatus;
  startedAt: number;
  completedAt?: number;
  /** Wall-clock duration of the agent execution, ms. */
  latencyMs?: number;
  answer?: string;
  toolCalls: ToolCallRecord[];
  failureModes: EvaluationFailureMode[];
  traceRef?: TraceReference;
  error?: ApiError;
  /**
   * How the run started. `not-started` is written when the kernel rejected
   * `startRun` outright (spawn/config failure) — the agent never executed, so
   * the run cannot be read as an agent-quality signal. Absent on records
   * persisted before this field existed; treat those as `started`.
   */
  execution?: EvaluationRunExecution;
  /**
   * Runtime config actually in effect for this run, confirmed by readback
   * (#114). `undefined` on historical records = unknown, not "default".
   */
  effectiveConfig?: EffectiveRuntimeConfig;
}

export type EvaluationRunExecution = 'started' | 'not-started';

/** Backend the trace lives in; `none` when observability is off (spec §89). */
export type TraceBackendKind = 'langsmith' | 'langfuse' | 'local' | 'none';

export interface TraceReference {
  backend: TraceBackendKind;
  traceId?: string;
  url?: string;
  /** Pi session id (= LangSmith thread_id) for trace lookup. */
  threadId?: string;
  sessionId?: string;
  runId?: string;
  /** Case/experiment runtime locale stamped into trace metadata (spec §74). */
  locale?: SupportedLocale;
}

export interface EvaluationResultRecord {
  id: string;
  runId: string;
  experimentId: string;
  caseId: string;
  scores: EvaluationScore[];
  failureModes: EvaluationFailureMode[];
  verdict: 'pass' | 'fail' | 'partial' | 'not-applicable';
  notes?: string;
}

// ── Experiment (spec §42-45, §79) ──────────────────────────────────────────

export interface ExperimentConfig {
  mode: 'fixture' | 'live';
  model?: string;
  provider?: string;
  thinkingLevel?: string;
  strategyId?: string;
  skillVersions?: Record<string, string>;
  capabilityRegistryVersion?: string;
  /** Judge model separate from the agent under test (spec §80). */
  judgeModel?: string;
  judgeProvider?: string;
  /** Cost guardrails (spec §79): 0 = unlimited. */
  maxCases?: number;
  concurrency?: number;
  timeoutMs?: number;
}

export type ExperimentStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ExperimentMetadata {
  gitSha?: string;
  folioVersion?: string;
  runtimeVersion?: string;
  piVersion?: string;
  providerConfiguration?: Record<string, unknown>;
  timestamp: number;
}

export interface MetricAggregate {
  metric: EvaluationMetricId;
  score: number | null;
  sampleCount: number;
}

export interface FailureModeCount {
  mode: EvaluationFailureMode;
  count: number;
  sampleCount: number;
}

export interface ExperimentSummary {
  /**
   * Pass rate over valid, applicable runs; null when no run produced a valid,
   * applicable measurement (an invalid experiment must not read as 0%).
   */
  passRate: number | null;
  /**
   * Mean of measurable scores from valid runs only; null when no valid run
   * exists. Never a headline benchmark score on its own — see `validity`.
   */
  compositeScore: number | null;
  metricAggregates: MetricAggregate[];
  failureModes: FailureModeCount[];
  /** Cases requested (selected for the experiment). */
  totalRuns: number;
  /** Cases that produced an interpretable agent-quality outcome (evaluated). */
  completedRuns: number;
  /**
   * Execution validity, separate from quality: `invalid` means no case
   * produced a valid run (missing runtime/credentials/data source), so no
   * quality claim can be made; `inconclusive` means some cases were
   * invalidated by infrastructure; `valid` means every requested case ran and
   * produced a quality outcome (completed, or started then failed the task).
   * Negative case outcomes stay `valid` — they are quality failures, not
   * execution failures.
   */
  validity: ExperimentValidity;
  /** Requested/started/evaluated/infra-failed/skipped run counts. */
  execution: ExperimentExecutionCounts;
  /** Distinct machine-readable reasons behind a non-valid outcome. */
  validityReasons: string[];
}

export type ExperimentValidity = 'valid' | 'inconclusive' | 'invalid';

export interface ExperimentExecutionCounts {
  /** Cases selected for the experiment. */
  requested: number;
  /** Cases whose agent run was accepted and began executing. */
  started: number;
  /**
   * Cases that produced an interpretable quality result: completed runs and
   * runs that started and then failed the task (timeout, tool loop, budget
   * exhaustion). Infrastructure failures and skipped runs are excluded.
   */
  evaluated: number;
  /**
   * Cases invalidated by infrastructure: the run never started (spawn/config/
   * credential rejection) or failed for an explicit runtime/process reason.
   * A started task failure is a quality result, not an infrastructure failure.
   */
  infraFailed: number;
  /** Cases never run: cancelled mid-flight or skipped after an abort. */
  skipped: number;
}

export interface EvaluationExperiment {
  id: string;
  name: string;
  datasetId: string;
  datasetVersion: string;
  status: ExperimentStatus;
  mode: 'fixture' | 'live';
  config: ExperimentConfig;
  metadata: ExperimentMetadata;
  startedAt: number;
  completedAt?: number;
  runIds: string[];
  resultIds: string[];
  summary?: ExperimentSummary;
  baselineId?: string;
  error?: ApiError;
}

// ── Baseline & regression gates (spec §75-78) ──────────────────────────────

export interface EvaluationBaseline {
  id: string;
  name: string;
  datasetId: string;
  datasetVersion: string;
  experimentId: string;
  gitSha: string;
  createdAt: number;
  metrics: Record<EvaluationMetricId, number>;
  /** Per-metric max |delta|; falls back to the metric definition default. */
  thresholds: Partial<Record<EvaluationMetricId, number>>;
}

export interface RegressionResult {
  metric: EvaluationMetricId;
  baseline: number | null;
  current: number | null;
  delta: number | null;
  maxDelta: number;
  critical: boolean;
  /** False when a critical metric regressed beyond maxDelta (spec §76). */
  passed: boolean;
}

// ── Observability settings & privacy (spec §11-13, §56-59) ─────────────────

export type PrivacyLevel = 'minimal' | 'standard' | 'full';

export interface EvaluationSettings {
  tracingEnabled: boolean;
  langsmithProject: string;
  /** Custom/self-hosted endpoint (empty = LangSmith cloud). */
  langsmithEndpoint: string;
  /** Folio-side Langfuse exporter for Agent / Deep Research traces. Independent of LangSmith. */
  langfuseTracingEnabled: boolean;
  /** Langfuse host (empty = https://cloud.langfuse.com). */
  langfuseHost: string;
  /** Mirror of the Langfuse credential store; renderer never sees keys. */
  langfuseConfigured: boolean;
  privacyLevel: PrivacyLevel;
  onlineEvaluationEnabled: boolean;
  /** Mirror of the credential store; renderer never sees the key (spec §12). */
  apiKeyConfigured: boolean;
  updatedAt: number;
}

export interface LangSmithConnectionStatus {
  connected: boolean;
  configured: boolean;
  project?: string;
  endpoint?: string;
  error?: string;
  message?: string;
}

/** Connection probe for Langfuse (same renderer-safe shape as LangSmith). */
export type LangfuseConnectionStatus = LangSmithConnectionStatus;

export interface SelectableModel {
  provider: string;
  id: string;
  label: string;
}
