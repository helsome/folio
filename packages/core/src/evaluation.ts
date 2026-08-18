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

import type { ApiError, ToolCallRecord, WorkspaceContext } from './index.ts';

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
}

/** Backend the trace lives in; `none` when observability is off (spec §89). */
export type TraceBackendKind = 'langsmith' | 'local' | 'none';

export interface TraceReference {
  backend: TraceBackendKind;
  traceId?: string;
  url?: string;
  /** Pi session id (= LangSmith thread_id) for trace lookup. */
  threadId?: string;
  sessionId?: string;
  runId?: string;
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
  passRate: number;
  compositeScore: number | null;
  metricAggregates: MetricAggregate[];
  failureModes: FailureModeCount[];
  totalRuns: number;
  completedRuns: number;
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

export interface SelectableModel {
  provider: string;
  id: string;
  label: string;
}