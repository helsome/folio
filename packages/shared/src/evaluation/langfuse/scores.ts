// Map Folio evaluation scores + research-run facts onto Langfuse score names.
import type { EvaluationScore, ResearchReport, ToolCallRecord } from '@finagent/core';
import type { LangfuseScoreInput } from './protocol.ts';

export const LANGFUSE_SCORE_GROUNDEDNESS = 'groundedness';
export const LANGFUSE_SCORE_CITATION_COVERAGE = 'citation_coverage';
export const LANGFUSE_SCORE_TASK_COMPLETION = 'task_completion';
export const LANGFUSE_SCORE_TOOL_RETRIEVAL = 'tool_retrieval_success';
export const LANGFUSE_SCORE_LATENCY_MS = 'latency_ms';

export function scoresFromEvaluation(scores: EvaluationScore[]): LangfuseScoreInput[] {
  const out: LangfuseScoreInput[] = [];
  for (const score of scores) {
    if (score.score === null || Number.isNaN(score.score)) continue;
    if (score.metric === 'groundedness' || score.metric === 'evidence_presence') {
      out.push({
        name: LANGFUSE_SCORE_GROUNDEDNESS,
        value: clamp01(score.score),
        comment: score.reason,
      });
    }
    if (score.metric === 'evidence_presence') {
      out.push({
        name: LANGFUSE_SCORE_CITATION_COVERAGE,
        value: clamp01(score.score),
        comment: score.reason,
      });
    }
    if (score.metric === 'task_completion') {
      out.push({
        name: LANGFUSE_SCORE_TASK_COMPLETION,
        value: clamp01(score.score),
        comment: score.reason,
      });
    }
    if (score.metric === 'tool_recall' || score.metric === 'tool_precision') {
      out.push({
        name: LANGFUSE_SCORE_TOOL_RETRIEVAL,
        value: clamp01(score.score),
        comment: `${score.metric}: ${score.reason ?? ''}`.trim(),
      });
    }
    if (score.metric === 'latency' && typeof score.value === 'number') {
      out.push({ name: LANGFUSE_SCORE_LATENCY_MS, value: score.value, comment: score.reason });
    }
  }
  return dedupeByName(out);
}

export function scoresFromResearchReport(
  report: Pick<ResearchReport, 'sections' | 'capabilityRuns' | 'runStatus'> | undefined,
  toolCalls?: ToolCallRecord[],
  latencyMs?: number
): LangfuseScoreInput[] {
  const out: LangfuseScoreInput[] = [];
  if (report) {
    const sections = report.sections;
    const withEvidence = sections.filter((section) => section.evidence.length > 0).length;
    const citation = sections.length === 0 ? 0 : withEvidence / sections.length;
    out.push({
      name: LANGFUSE_SCORE_CITATION_COVERAGE,
      value: clamp01(citation),
      comment: `${withEvidence}/${sections.length} sections carry evidence refs`,
    });
    const grounded = sections.length === 0 ? 0 : citation;
    out.push({
      name: LANGFUSE_SCORE_GROUNDEDNESS,
      value: clamp01(grounded),
      comment: 'Deterministic evidence-ref coverage (not an LLM judge).',
    });
    const runs = report.capabilityRuns;
    const success = runs.filter((run) => run.status === 'success').length;
    out.push({
      name: LANGFUSE_SCORE_TOOL_RETRIEVAL,
      value: runs.length === 0 ? 0 : clamp01(success / runs.length),
      comment: `${success}/${runs.length} capabilities succeeded`,
    });
    out.push({
      name: LANGFUSE_SCORE_TASK_COMPLETION,
      value: report.runStatus === 'completed' ? 1 : report.runStatus === 'partial' ? 0.5 : 0,
      comment: `runStatus=${report.runStatus}`,
    });
  } else if (toolCalls) {
    const success = toolCalls.filter((call) => call.status === 'success').length;
    out.push({
      name: LANGFUSE_SCORE_TOOL_RETRIEVAL,
      value: toolCalls.length === 0 ? 0 : clamp01(success / toolCalls.length),
      comment: `${success}/${toolCalls.length} tools succeeded`,
    });
  }
  if (typeof latencyMs === 'number') {
    out.push({ name: LANGFUSE_SCORE_LATENCY_MS, value: Math.max(0, latencyMs) });
  }
  return out;
}

/** Engineering scores for a Copilot / Agent run (no research report). */
export function scoresFromAgentRun(input: {
  completed: boolean;
  toolCalls?: ToolCallRecord[];
  latencyMs?: number;
}): LangfuseScoreInput[] {
  return [
    {
      name: LANGFUSE_SCORE_TASK_COMPLETION,
      value: input.completed ? 1 : 0,
      comment: input.completed ? 'run completed' : 'run failed',
    },
    ...scoresFromResearchReport(undefined, input.toolCalls, input.latencyMs),
  ];
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function dedupeByName(scores: LangfuseScoreInput[]): LangfuseScoreInput[] {
  const map = new Map<string, LangfuseScoreInput>();
  for (const score of scores) map.set(score.name, score);
  return [...map.values()];
}
