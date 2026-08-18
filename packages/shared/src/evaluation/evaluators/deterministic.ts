// Deterministic evaluators (spec §28-33, §106).
//
// Pure functions over the recorded run: no LLM, no I/O. Each metric computes
// a normalized 0..1 score (or null when not applicable) from the tool-call
// record, the run outcome, and the case expectations. All twelve are exact:
// fixture runs (spec §106) must reproduce bit-for-bit identical scores.
//
// Tool-name mapping: case expectations name *capability ids* (e.g.
// `market.quote`); the agent surfaces them as tools (`get_quote`). The
// capability id -> tool name and tool name -> input schema lookups are built
// once from the capability manifests — the single source of truth — so a
// manifest rename cannot silently desync the evaluators.
import { Value } from '@sinclair/typebox/value';
import type { TSchema } from '@sinclair/typebox';
import {
  EVALUATION_METRICS,
  type EvaluationMetricId,
  type EvaluationScore,
  type ToolCallRecord,
} from '@finagent/core';
import { fullCapabilities } from '../../capabilities/index.ts';
import type { EvaluationContext, EvaluatorDefinition, EvaluatorRegistry } from '../evaluator.ts';

// ── Static lookup tables (built once at module load from the manifests) ────

const ID_TO_TOOL: Record<string, string> = {};
const TOOL_SCHEMAS: Record<string, TSchema> = {};
for (const capability of fullCapabilities) {
  ID_TO_TOOL[capability.id] = capability.toolName;
  TOOL_SCHEMAS[capability.toolName] = capability.inputSchema;
}

/** Metric name + rubric version, kept in lockstep with EVALUATION_METRICS. */
const METRIC_META: Record<EvaluationMetricId, { name: string; version: string }> = Object.fromEntries(
  EVALUATION_METRICS.map((metric) => [metric.id, { name: metric.name, version: metric.version }])
) as Record<EvaluationMetricId, { name: string; version: string }>;

// ── Shared helpers ─────────────────────────────────────────────────────────

function result(
  metric: EvaluationMetricId,
  score: number | null,
  reason: string,
  extra: { detail?: unknown; value?: number; unit?: string } = {}
): EvaluationScore {
  return {
    metric,
    metricVersion: METRIC_META[metric].version,
    score,
    reason,
    detail: extra.detail,
    value: extra.value,
    unit: extra.unit,
  };
}

/** Map expectation capability ids to the agent tool names they surface as. */
function toolNamesFor(capabilityIds: string[] | undefined): string[] {
  return (capabilityIds ?? []).map((id) => ID_TO_TOOL[id] ?? id);
}

/** The union of required and optional capability tool names for the case. */
function expectationToolNames(context: EvaluationContext): Set<string> {
  return new Set([...toolNamesFor(context.case.expected.requiredCapabilities), ...toolNamesFor(context.case.expected.optionalCapabilities)]);
}

function isStructuredResult(value: unknown): value is { data: unknown; provenance?: unknown } {
  return typeof value === 'object' && value !== null && 'data' in value;
}

/** Tool results are `{ data, provenance? }` (StructuredToolResult) or plain objects. */
function resultPayload(result: unknown): unknown {
  if (isStructuredResult(result)) return result.data;
  return result;
}

/** A successful call is "evidence" only when it returned non-empty data. */
function hasEvidenceContent(result: unknown): boolean {
  const payload = resultPayload(result);
  if (payload === null || payload === undefined) return false;
  if (typeof payload === 'string') return payload.trim().length > 0;
  if (Array.isArray(payload)) return payload.length > 0;
  if (typeof payload === 'object') return Object.keys(payload).length > 0;
  return true; // numbers and booleans carry information even when falsy
}

/** Provenance (`provider` + `fetchedAt`) wherever it lives on the result. */
function provenanceOf(result: unknown): { provider: string; fetchedAt: number } | null {
  if (typeof result !== 'object' || result === null || !('provenance' in result)) return null;
  const provenance = result.provenance;
  if (typeof provenance !== 'object' || provenance === null) return null;
  const provider = 'provider' in provenance ? provenance.provider : undefined;
  const fetchedAt = 'fetchedAt' in provenance ? provenance.fetchedAt : undefined;
  if (typeof provider === 'string' && provider.length > 0 && typeof fetchedAt === 'number') {
    return { provider, fetchedAt };
  }
  return null;
}

/** A manifest schema with no properties means the tool takes no arguments. */
function isEmptyArgsSchema(schema: TSchema | undefined): boolean {
  if (typeof schema !== 'object' || schema === null) return false;
  if (schema.type !== 'object') return false;
  const properties = 'properties' in schema ? schema.properties : undefined;
  return properties === undefined || Object.keys(properties).length === 0;
}

/** Args satisfy the capability input schema (empty-args tools accept only {}). */
function argsMatchSchema(schema: TSchema | undefined, args: Record<string, unknown>): boolean {
  if (isEmptyArgsSchema(schema)) return Object.keys(args).length === 0;
  return schema !== undefined && Value.Check(schema, args);
}

/** Freshness timestamp for a call: provenance `fetchedAt`, else `completedAt`. */
function hasTimestamp(entry: { call: ToolCallRecord; timestamp: number | undefined }): entry is { call: ToolCallRecord; timestamp: number } {
  return entry.timestamp !== undefined;
}

// ── The twelve deterministic evaluators ────────────────────────────────────

function def(metric: EvaluationMetricId, evaluate: (context: EvaluationContext) => EvaluationScore): EvaluatorDefinition {
  return {
    metric,
    name: METRIC_META[metric].name,
    kind: 'deterministic',
    version: METRIC_META[metric].version,
    evaluate,
  };
}

function createEvaluators(): EvaluatorDefinition[] {
  return [
    // Spec §28: 1.0 when the run completed with a non-empty answer and no
    // failing failure modes; 0.5 when it answered despite failures; 0.0
    // otherwise. `judge_error` is an evaluation-infrastructure outcome, not an
    // agent failure, so it never halves the score.
    def('task_completion', (context) => {
      const { run } = context;
      const hasAnswer = typeof run.answer === 'string' && run.answer.trim().length > 0;
      if (run.status !== 'completed' || !hasAnswer) {
        return result('task_completion', 0, `run ${run.status} without a non-empty answer`, {
          detail: { status: run.status, hasAnswer },
        });
      }
      const failing = run.failureModes.filter((mode) => mode !== 'judge_error');
      if (failing.length === 0) {
        return result('task_completion', 1, 'completed with an answer and no failing failure modes');
      }
      return result('task_completion', 0.5, `completed with an answer but ${failing.length} failing failure mode(s)`, {
        detail: { failing },
      });
    }),

    // Spec §29: used required tool names / required count; 1.0 when the case
    // declares no required capabilities. "Used" means invoked (selection
    // coverage); execution failures are scored by tool_error_rate and the
    // failure-handling metrics instead.
    def('tool_recall', (context) => {
      const required = toolNamesFor(context.case.expected.requiredCapabilities);
      if (required.length === 0) {
        return result('tool_recall', 1, 'no required capabilities declared');
      }
      const used = new Set(context.toolCalls.map((call) => call.toolName));
      const missing = required.filter((name) => !used.has(name));
      const covered = required.length - missing.length;
      return result('tool_recall', covered / required.length, `${covered}/${required.length} required tools used`, {
        detail: { required, missing },
        value: covered,
        unit: 'tools',
      });
    }),

    // Spec §30: relevant = unique successful calls matching required∪optional;
    // precision = relevant / total unique calls; 1.0 when no calls were made.
    def('tool_precision', (context) => {
      const relevantTools = expectationToolNames(context);
      const uniqueCalls = new Map<string, boolean>(); // toolName -> had a successful call
      for (const call of context.toolCalls) {
        uniqueCalls.set(call.toolName, (uniqueCalls.get(call.toolName) ?? false) || call.status === 'success');
      }
      if (uniqueCalls.size === 0) {
        return result('tool_precision', 1, 'no tool calls made');
      }
      let relevant = 0;
      const irrelevant: string[] = [];
      for (const [toolName, hadSuccess] of uniqueCalls) {
        if (hadSuccess && relevantTools.has(toolName)) {
          relevant += 1;
        } else if (hadSuccess) {
          irrelevant.push(toolName);
        }
      }
      return result('tool_precision', relevant / uniqueCalls.size, `${relevant}/${uniqueCalls.size} unique calls were relevant`, {
        detail: { relevant, total: uniqueCalls.size, irrelevant },
        value: relevant,
        unit: 'calls',
      });
    }),

    // Spec §31: score = 1 - (failed / total calls); no calls means no failures.
    def('tool_error_rate', (context) => {
      const total = context.toolCalls.length;
      if (total === 0) {
        return result('tool_error_rate', 1, 'no tool calls were made');
      }
      const failed = context.toolCalls.filter((call) => call.status === 'error');
      return result('tool_error_rate', 1 - failed.length / total, `${failed.length}/${total} tool calls failed`, {
        detail: { failed: failed.map((call) => ({ id: call.id, toolName: call.toolName })) },
        value: failed.length,
        unit: 'failures',
      });
    }),

    // Spec §32: fraction of required-capability calls whose args satisfy the
    // capability input schema; empty-args tools (e.g. portfolio) accept only
    // `{}` — any argument payload is invalid.
    def('argument_validity', (context) => {
      const requiredTools = new Set(toolNamesFor(context.case.expected.requiredCapabilities));
      const requiredCalls = context.toolCalls.filter((call) => requiredTools.has(call.toolName));
      if (requiredCalls.length === 0) {
        return result('argument_validity', 1, 'no required-capability calls to validate');
      }
      const mismatches: Array<{ id: string; toolName: string; path: string; message: string }> = [];
      let valid = 0;
      for (const call of requiredCalls) {
        const schema = TOOL_SCHEMAS[call.toolName];
        if (argsMatchSchema(schema, call.args)) {
          valid += 1;
        } else if (!schema) {
          mismatches.push({ id: call.id, toolName: call.toolName, path: '/', message: 'no input schema registered for this tool' });
        } else if (isEmptyArgsSchema(schema)) {
          mismatches.push({
            id: call.id,
            toolName: call.toolName,
            path: '/',
            message: `${call.toolName} takes no arguments; received ${Object.keys(call.args).length}`,
          });
        } else {
          const error = [...Value.Errors(schema, call.args)][0];
          mismatches.push({
            id: call.id,
            toolName: call.toolName,
            path: error?.path ?? '/',
            message: error?.message ?? 'arguments do not match the input schema',
          });
        }
      }
      return result('argument_validity', valid / requiredCalls.length, `${valid}/${requiredCalls.length} required-capability calls had valid arguments`, {
        detail: { mismatches },
        value: valid,
        unit: 'calls',
      });
    }),

    // Spec §33: 1.0 when total calls ≤ expected.maxToolCalls (default 8).
    def('max_tool_calls', (context) => {
      const limit = context.case.expected.maxToolCalls ?? 8;
      const total = context.toolCalls.length;
      return result('max_tool_calls', total <= limit ? 1 : 0, `${total} tool calls against limit ${limit}`, {
        detail: { total, limit },
        value: total,
        unit: 'calls',
      });
    }),

    // Spec §33: mustHaveEvidence ⇒ 1.0 iff ≥1 successful call returned
    // non-empty data; otherwise 1.0 when evidence exists, null when it does not.
    def('evidence_presence', (context) => {
      const required = context.case.expected.mustHaveEvidence === true;
      const evidenceCalls = context.toolCalls.filter((call) => call.status === 'success' && hasEvidenceContent(call.result));
      const has = evidenceCalls.length > 0;
      const detail = { evidenceCalls: evidenceCalls.map((call) => call.id) };
      if (required) {
        return result(
          'evidence_presence',
          has ? 1 : 0,
          has ? 'successful calls returned evidence' : 'no successful call returned evidence',
          { detail, value: evidenceCalls.length, unit: 'calls' }
        );
      }
      return result(
        'evidence_presence',
        has ? 1 : null,
        has ? 'evidence present (not required by the case)' : 'no evidence (not required by the case)',
        { detail, value: evidenceCalls.length, unit: 'calls' }
      );
    }),

    // Spec §33: fraction of successful calls carrying provenance (provider +
    // fetchedAt); null when there are no successful calls.
    def('provenance_presence', (context) => {
      const successful = context.toolCalls.filter((call) => call.status === 'success');
      if (successful.length === 0) {
        return result('provenance_presence', null, 'no successful tool calls to check', {
          detail: { successfulCalls: 0 },
        });
      }
      const missing = successful.filter((call) => provenanceOf(call.result) === null);
      const withProvenance = successful.length - missing.length;
      return result(
        'provenance_presence',
        withProvenance / successful.length,
        `${withProvenance}/${successful.length} successful calls carried provenance`,
        { detail: { missingProvenance: missing.map((call) => ({ id: call.id, toolName: call.toolName })) }, value: withProvenance, unit: 'calls' }
      );
    }),

    // Spec §33: with a freshnessRequirementMs, 1.0 iff the freshest relevant
    // call's fetchedAt (or completedAt) is within now - requirement; null when
    // the case sets no requirement.
    def('freshness_compliance', (context) => {
      const requirementMs = context.case.expected.freshnessRequirementMs;
      if (requirementMs === undefined || requirementMs === null) {
        return result('freshness_compliance', null, 'no freshness requirement set for this case');
      }
      const relevantTools = expectationToolNames(context);
      const relevantCalls = context.toolCalls.filter((call) => call.status === 'success' && relevantTools.has(call.toolName));
      const timestamped = relevantCalls
        .map((call) => ({ call, timestamp: provenanceOf(call.result)?.fetchedAt ?? call.completedAt }))
        .filter(hasTimestamp);
      if (timestamped.length === 0) {
        return result('freshness_compliance', 0, 'no relevant successful call carried a freshness timestamp', {
          detail: { relevantCalls: relevantCalls.map((call) => call.id), freshnessRequirementMs: requirementMs },
        });
      }
      const freshest = Math.max(...timestamped.map((entry) => entry.timestamp));
      const now = context.now();
      const ageMs = now - freshest;
      const compliant = ageMs <= requirementMs;
      return result(
        'freshness_compliance',
        compliant ? 1 : 0,
        `freshest relevant data is ${ageMs}ms old (limit ${requirementMs}ms)`,
        { detail: { freshestAt: freshest, ageMs, now, freshnessRequirementMs: requirementMs }, value: ageMs, unit: 'ms' }
      );
    }),

    // Spec §33: when any call failed, 1.0 iff the answer mentions the failure
    // (failed tool name or fail/error/unavailable wording); null when nothing
    // failed.
    def('partial_failure_honesty', (context) => {
      const failed = context.toolCalls.filter((call) => call.status === 'error');
      if (failed.length === 0) {
        return result('partial_failure_honesty', null, 'no tool call failed', {
          detail: { failedCalls: 0 },
        });
      }
      const answer = (context.run.answer ?? '').toLowerCase();
      const mentionKeyword = answer.includes('fail') || answer.includes('error') || answer.includes('unavailable');
      const mentionsFailure = failed.some((call) => mentionKeyword || answer.includes(call.toolName.toLowerCase()));
      return result(
        'partial_failure_honesty',
        mentionsFailure ? 1 : 0,
        mentionsFailure ? 'the answer discloses the tool failure' : 'the answer does not disclose the tool failure',
        { detail: { failedCalls: failed.map((call) => ({ id: call.id, toolName: call.toolName })) } }
      );
    }),

    // Spec §33: score = clamp(1 - latencyMs / 60s, 0..1); latencyMs is the raw
    // measured value. Always applies (fixture runs record latencyMs directly).
    def('latency', (context) => {
      const { run } = context;
      const latencyMs =
        run.latencyMs ??
        (run.completedAt !== undefined ? run.completedAt - run.startedAt : Math.max(0, context.now() - run.startedAt));
      const normalized = Math.min(1, Math.max(0, 1 - latencyMs / 60_000));
      return result('latency', normalized, `${latencyMs}ms latency against a 60s budget`, {
        detail: { latencyMs, budgetMs: 60_000 },
        value: latencyMs,
        unit: 'ms',
      });
    }),

    // Spec §33: when a call failed, 1.0 iff a later successful call with a
    // different tool exists, or the answer mentions retry/fallback; null when
    // nothing failed.
    def('failure_recovery', (context) => {
      const failed = context.toolCalls.filter((call) => call.status === 'error');
      if (failed.length === 0) {
        return result('failure_recovery', null, 'no tool call failed', {
          detail: { failedCalls: 0 },
        });
      }
      const answer = (context.run.answer ?? '').toLowerCase();
      const mentionsRetry = /retry|retried|retrying|fallback|fall back/.test(answer);
      const laterSuccessful = failed.some((failedCall) =>
        context.toolCalls.some(
          (call) =>
            call.status === 'success' && call.startedAt > failedCall.startedAt && call.toolName !== failedCall.toolName
        )
      );
      const recovered = mentionsRetry || laterSuccessful;
      return result(
        'failure_recovery',
        recovered ? 1 : 0,
        recovered
          ? mentionsRetry
            ? 'the answer discloses a retry or fallback'
            : 'a later successful call used a different tool'
          : 'no recovery signal: no later successful call and no retry/fallback mention',
        { detail: { failedCalls: failed.map((call) => ({ id: call.id, toolName: call.toolName })) } }
      );
    }),
  ];
}

/** All twelve deterministic evaluators (spec §28-33): one per metric id. */
export function createDeterministicEvaluators(): EvaluatorDefinition[] {
  return createEvaluators();
}

/** Register the deterministic evaluators into the given registry. */
export function registerDeterministicEvaluators(registry: EvaluatorRegistry): void {
  for (const definition of createEvaluators()) {
    registry.register(definition);
  }
}