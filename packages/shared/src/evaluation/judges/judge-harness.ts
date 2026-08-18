// LLM judge harness (spec §107).
//
// The harness is the single place where a versioned rubric meets the judge
// model: it renders the prompt, parses the model's STRICT JSON reply
// (tolerating ```json code fences and surrounding prose), validates the shape,
// and clamps the score into 0..1. Every failure path — transport error,
// unparseable reply, structurally invalid JSON — degrades to `score: null`
// with a `judge_error:` reason. The harness never throws, so a judge hiccup is
// a data point (null score) instead of a crashed experiment.
import type { EvaluationContext } from '../evaluator.ts';
import type { EvaluationMetricId, EvaluationScore } from '@finagent/core';
import type { JudgeClient } from '../judge-client.ts';
import { isRecord } from '../../guards.ts';

export interface JudgeRubric {
  /** Metric this rubric scores (e.g. 'groundedness'). */
  id: EvaluationMetricId;
  /** Versioned rubric id, e.g. 'groundedness-v1' (spec §81). */
  version: string;
  systemPrompt: string;
  /** Must instruct the model to reply with STRICT JSON {score, reason, evidence?}. */
  userPrompt: string;
}

const JSON_FENCE = /```(?:json)?\s*([\s\S]*?)```/gi;

/** True when the run produced a non-empty answer — the LLM judge input floor. */
export function hasAnswer(context: EvaluationContext): boolean {
  const answer = context.run.answer;
  return typeof answer === 'string' && answer.trim() !== '';
}

/** Render a tool result as plain text for the judge corpus. */
export function toolResultText(result: unknown): string | undefined {
  if (typeof result === 'string') return result;
  if (result === null || result === undefined) return undefined;
  if (Array.isArray(result)) {
    const parts = result
      .map((item) => toolResultText(item))
      .filter((part): part is string => part !== undefined);
    return parts.length > 0 ? parts.join('\n') : undefined;
  }
  if (isRecord(result)) {
    for (const key of ['text', 'content'] as const) {
      const value = result[key];
      if (typeof value === 'string' && value.trim() !== '') return value;
    }
    if (result.data !== undefined) return toolResultText(result.data);
    return JSON.stringify(result);
  }
  return String(result);
}

function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}…(truncated)`;
}

/**
 * Evidence corpus for groundedness-style judges: the recorded tool result
 * texts of the run, labeled by tool. Deterministic run order keeps judge input
 * stable across identical runs. Long payloads are truncated per call.
 */
export function formatToolCorpus(context: EvaluationContext): string {
  const sections: string[] = [];
  for (const call of context.toolCalls) {
    const text = toolResultText(call.result);
    if (text === undefined || text.trim() === '') continue;
    sections.push(`[tool: ${call.toolName}]\n${truncate(text, 4000)}`);
  }
  return sections.join('\n\n');
}

interface ParsedJudgeResult {
  score: number;
  reason: string;
  evidence?: string[];
}

function clampScore(score: number): number {
  return Math.min(1, Math.max(0, score));
}

function parseStrictJson(candidate: string): unknown {
  const trimmed = candidate.trim();
  if (trimmed === '') return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function validateJudgeResult(value: unknown): ParsedJudgeResult | undefined {
  if (!isRecord(value)) return undefined;
  const { score, reason, evidence } = value;
  if (typeof score !== 'number' || !Number.isFinite(score)) return undefined;
  if (typeof reason !== 'string' || reason.trim() === '') return undefined;
  if (evidence !== undefined && (!Array.isArray(evidence) || evidence.some((item) => typeof item !== 'string'))) {
    return undefined;
  }
  return { score: clampScore(score), reason, evidence };
}

/**
 * Extract the judge's STRICT JSON object from the raw reply, trying in order:
 * the whole reply, every fenced ```json block, then the span from the first
 * `{` to the last `}` (JSON buried in prose). A candidate that parses as JSON
 * must already be the right shape — valid JSON of the wrong shape (e.g. an
 * array) is a contract violation, not something to rescue.
 */
function parseJudgeReply(reply: string): ParsedJudgeResult | undefined {
  const braceSpan = (() => {
    const first = reply.indexOf('{');
    const last = reply.lastIndexOf('}');
    return first >= 0 && last > first ? reply.slice(first, last + 1) : undefined;
  })();
  const candidates = [reply];
  for (const match of reply.matchAll(JSON_FENCE)) candidates.push(match[1]);
  if (braceSpan !== undefined) candidates.push(braceSpan);
  for (const candidate of candidates) {
    const parsed = parseStrictJson(candidate);
    if (parsed === undefined) continue; // not JSON — try the next form
    return validateJudgeResult(parsed);
  }
  return undefined;
}

function failureScore(rubric: JudgeRubric, detail: unknown): EvaluationScore {
  const message = detail instanceof Error ? detail.message : String(detail);
  return {
    metric: rubric.id,
    metricVersion: rubric.version,
    score: null,
    reason: `judge_error: ${message}`,
  };
}

/**
 * Run a versioned rubric against the judge model. Never throws: any failure —
 * transport error, abort, malformed reply, invalid shape — is returned as
 * `score: null` with a `judge_error:` reason.
 */
export async function runJudge(
  client: JudgeClient,
  rubric: JudgeRubric,
  _context: EvaluationContext,
  signal?: AbortSignal,
): Promise<EvaluationScore> {
  try {
    const reply = await client.complete(rubric.systemPrompt, rubric.userPrompt, signal);
    const parsed = parseJudgeReply(reply);
    if (parsed === undefined) {
      return failureScore(
        rubric,
        'malformed judge reply; expected STRICT JSON {"score": 0..1, "reason": string, "evidence"?: string[]}',
      );
    }
    const hasEvidence = parsed.evidence !== undefined && parsed.evidence.length > 0;
    return {
      metric: rubric.id,
      metricVersion: rubric.version,
      score: parsed.score,
      reason: parsed.reason,
      ...(hasEvidence ? { detail: { evidence: parsed.evidence } } : {}),
    };
  } catch (error) {
    return failureScore(rubric, error);
  }
}