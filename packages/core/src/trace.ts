// V9.1 Trace domain — source-neutral projection types (spec §2–4, §16).
//
// A FolioTrace is a READ-ONLY projection over authoritative persisted sources
// (Run, Message, ToolCallRecord, AgentTraceEvent, EvaluationRun, EvaluationCase
// input, TraceReference). It is never persisted, never fabricated, and never
// reconstructs historical context from current renderer atoms. Sources are
// listed explicitly so the inspector can represent incompleteness honestly.
import type { TraceReference } from './evaluation.ts';
import type { SupportedLocale } from './locale.ts';

/** How complete the recorded evidence for a run is (spec §4). */
export type TraceCompleteness = 'complete' | 'partial' | 'minimal';

/** Where a context field was actually recorded (spec §9–10). */
export type TraceContextSource =
  | 'recorded'
  | 'evaluation-input'
  | 'runtime'
  | 'live'
  | 'not-recorded';

/** One context field with an explicit provenance label — never guessed. */
export interface TraceContextField {
  /** Stable key, e.g. 'workspace', 'strategy', 'model'. */
  key: string;
  /** Human value, e.g. "NVDA.US · Research". */
  value: string;
  source: TraceContextSource;
}

/** Which authoritative source produced a trace element (spec §3). */
export type TraceElementSource =
  | 'event'
  | 'message'
  | 'trace-event'
  | 'run'
  | 'evaluation'
  | 'langsmith';

export interface TraceToolExecution {
  id: string;
  toolName: string;
  status: 'success' | 'error' | 'running';
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  args?: Record<string, unknown>;
  resultType?: string;
  error?: string;
  source: TraceElementSource;
}

export type TraceStepKind = 'user' | 'assistant' | 'tool' | 'run' | 'runtime';

export interface TraceStep {
  id: string;
  kind: TraceStepKind;
  /** User-facing label (semantic presentation, never a raw id). */
  label: string;
  detail?: string;
  timestamp: number;
  status?: 'success' | 'error' | 'running';
  tool?: TraceToolExecution;
  source: TraceElementSource;
}

/** Evaluation findings are JUDGMENT, kept separate from execution facts (spec §7). */
export interface TraceEvaluationFinding {
  verdict: 'pass' | 'fail' | 'partial';
  /** Stable failure mode id when present (e.g. 'missing_tool'). */
  failureMode?: string;
  detail?: string;
  /** Expected capabilities / tools from the case definition. */
  expected?: string[];
  /** Capabilities / tools actually executed. */
  actual?: string[];
  /** Normalized metric scores when recorded (never fabricated). */
  metricScores?: Array<{ metric: string; score: number | null; reason?: string }>;
}

/** Token usage — shown ONLY when the runtime actually recorded it (spec §11). */
export interface TraceTokenBudget {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface FolioTrace {
  runId: string;
  sessionId?: string;
  status: 'completed' | 'failed' | 'cancelled' | 'running';
  startedAt: number;
  completedAt?: number;
  latencyMs?: number;
  input: string;
  answer?: string;
  error?: string;
  completeness: TraceCompleteness;
  /** Authoritative sources that contributed (run/message/event/trace-event/evaluation/langsmith). */
  sources: TraceElementSource[];
  tools: TraceToolExecution[];
  steps: TraceStep[];
  context: TraceContextField[];
  /** Evaluation judgment — never merged into the execution timeline. */
  evaluation?: TraceEvaluationFinding;
  traceRef?: TraceReference;
  /** Token usage when actually recorded; undefined = "not recorded". */
  budget?: TraceTokenBudget;
  locale?: SupportedLocale;
}
