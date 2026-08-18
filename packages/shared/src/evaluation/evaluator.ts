// Evaluator registry (spec §27, §34, §81).
//
// Evaluators are registered per metric id with a version. Deterministic
// evaluators are pure functions over the recorded run; LLM judges are async
// and must return structured results — a parse failure marks the score null
// and records `judge_error` instead of crashing the experiment (§107).
import type {
  EvaluationCase,
  EvaluationDataset,
  EvaluationFailureMode,
  EvaluationMetricId,
  EvaluationRun,
  EvaluationScore,
  EvaluationSettings,
  ToolCallRecord,
} from '@finagent/core';

export interface EvaluationContext {
  case: EvaluationCase;
  dataset: EvaluationDataset;
  run: EvaluationRun;
  settings: EvaluationSettings;
  /** All recorded tool calls of the run (post-redaction). */
  toolCalls: ToolCallRecord[];
  now: () => number;
}

/** Structured judge output contract (spec §107). */
export interface EvaluationJudgeResult {
  score: number | null;
  reason: string;
  evidence?: string[];
  /** Judge rubric version (e.g. groundedness-v1). */
  version: string;
}

export type EvaluatorKind = 'deterministic' | 'llm-judge' | 'trajectory';

export interface EvaluatorDefinition {
  metric: EvaluationMetricId;
  name: string;
  kind: EvaluatorKind;
  version: string;
  /** Run for the given evaluation context. May return a single score. */
  evaluate: (context: EvaluationContext) => Promise<EvaluationScore> | EvaluationScore;
  /** True when the metric applies to this case (e.g. no latency in fixture mode). */
  appliesTo?: (context: EvaluationContext) => boolean;
}

export class EvaluatorRegistry {
  private readonly evaluators = new Map<EvaluationMetricId, EvaluatorDefinition>();

  register(definition: EvaluatorDefinition): void {
    if (this.evaluators.has(definition.metric)) {
      throw new Error(`Evaluator for metric ${definition.metric} is already registered.`);
    }
    this.evaluators.set(definition.metric, definition);
  }

  /** Replace an evaluator (e.g. version bump or test doubles). */
  replace(definition: EvaluatorDefinition): void {
    this.evaluators.set(definition.metric, definition);
  }

  get(metric: EvaluationMetricId): EvaluatorDefinition | undefined {
    return this.evaluators.get(metric);
  }

  list(): EvaluatorDefinition[] {
    return [...this.evaluators.values()];
  }

  /** Metrics that have a registered evaluator. */
  coveredMetrics(): EvaluationMetricId[] {
    return [...this.evaluators.keys()];
  }

  /**
   * Run every registered evaluator applicable to the case. Judge failures
   * degrade to `{ score: null, judge_error }` and never reject the caller.
   */
  async evaluateAll(
    context: EvaluationContext,
    options: { includeJudges: boolean },
  ): Promise<{ scores: EvaluationScore[]; failures: EvaluationFailureMode[] }> {
    const scores: EvaluationScore[] = [];
    const failures: EvaluationFailureMode[] = [];
    for (const definition of this.evaluators.values()) {
      if (definition.kind === 'llm-judge' && !options.includeJudges) continue;
      if (definition.appliesTo && !definition.appliesTo(context)) continue;
      try {
        const score = await definition.evaluate(context);
        scores.push(score);
      } catch (error) {
        failures.push('judge_error');
        scores.push({
          metric: definition.metric,
          metricVersion: definition.version,
          score: null,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { scores, failures };
  }
}
