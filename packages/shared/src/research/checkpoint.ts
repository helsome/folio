import { createHash } from 'node:crypto';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { ResearchExecutionIdentity, ResearchReport, ResearchRunSummary, ResearchSynthesis } from '@finagent/core';
import type { RunOutcome } from '../capabilities/executor.ts';
import { BUDGET_KEYS, type RunBudgetLimits, type RunBudgetUsage } from '../kernel/run-budget.ts';
import { createCodeError } from '../agent/errors.ts';
import { parseSynthesisJson } from './agent-synth.ts';
import type { PlannedCapability } from './planner.ts';

export const CHECKPOINT_VERSION = 1;
export const SETTLED_RESEARCH_STATUSES = new Set(['completed', 'partial', 'failed', 'cancelled']);

/** The checkpoint is authoritative; runs.json is only its UI projection. */
export interface ResearchCheckpoint {
  version: 1;
  summary: ResearchRunSummary;
  identity: ResearchExecutionIdentity;
  plan: Array<PlannedCapability & { input: unknown }>;
  outcomes: RunOutcome[];
  synthesis?: ResearchSynthesis;
  report?: ResearchReport;
  phase: 'fetching' | 'synthesizing' | 'publishing';
  budget: { limits: RunBudgetLimits; usage: RunBudgetUsage };
  retry: { attempts: Record<string, number>; synthesisAttempts: number };
  /** Persisted before dispatch. Uncertain read-only calls can be retried. */
  inFlight: string[];
  events: Array<{
    runId: string;
    spanId: string;
    parentRunId: string;
    type: 'started' | 'interrupted' | 'recovery' | 'step' | 'synthesis' | 'published';
    at: number;
    stepId?: string;
    agentRunId?: string;
    sessionId?: string;
  }>;
}

const number = Type.Number({ minimum: 0 });
const strings = Type.Array(Type.String());
const provenance = Type.Object({
  provider: Type.String(), fetchedAt: number, stale: Type.Boolean(),
});
const usage = Type.Object(Object.fromEntries(BUDGET_KEYS.map((key) => [key, number])));
const schema = Type.Object({
  version: Type.Literal(CHECKPOINT_VERSION),
  summary: Type.Object({
    id: Type.String({ pattern: '^[a-zA-Z0-9_-]+$' }),
    symbol: Type.String({ minLength: 1 }),
    status: Type.Union(['queued', 'fetching', 'synthesizing', 'interrupted', 'recovering',
      'completed', 'partial', 'failed', 'cancelled'].map((s) => Type.Literal(s))),
    startedAt: number,
    finishedAt: Type.Optional(number), reportId: Type.Optional(Type.String()),
    strategyId: Type.Optional(Type.String()), locale: Type.Optional(Type.Union([Type.Literal('en-US'), Type.Literal('zh-CN')])),
    recoveryCount: Type.Optional(Type.Integer({ minimum: 0 })), recoverable: Type.Optional(Type.Boolean()),
    cancelled: Type.Optional(Type.Boolean()), error: Type.Optional(Type.String()),
    plannedCapabilities: strings, completedCapabilities: strings, failedCapabilities: strings,
  }),
  identity: Type.Object({ provider: Type.String(), model: Type.String(), config: Type.String() }),
  plan: Type.Array(Type.Object({ capabilityId: Type.String(), available: Type.Boolean(), input: Type.Unknown() })),
  outcomes: Type.Array(Type.Object({
    record: Type.Object({
      id: Type.String(), capabilityId: Type.String(), startedAt: number, finishedAt: number,
      durationMs: number,
      status: Type.Union(['success', 'failed', 'unavailable', 'cancelled'].map((s) => Type.Literal(s))),
    }),
    result: Type.Optional(Type.Object({ data: Type.Unknown(), provenance })),
  })),
  phase: Type.Union(['fetching', 'synthesizing', 'publishing'].map((s) => Type.Literal(s))),
  budget: Type.Object({ limits: Type.Record(Type.String(), number), usage }),
  retry: Type.Object({
    attempts: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
    synthesisAttempts: Type.Integer({ minimum: 0 }),
  }),
  inFlight: strings,
  events: Type.Array(Type.Object({
    runId: Type.String(), spanId: Type.String(), parentRunId: Type.String(),
    type: Type.Union(['started', 'interrupted', 'recovery', 'step', 'synthesis', 'published'].map((s) => Type.Literal(s))),
    at: number,
  })),
});

export function checkpointError(message: string): Error {
  return createCodeError('RESEARCH_CHECKPOINT_INVALID', message);
}

export function validateCheckpoint(value: unknown, runId: string): ResearchCheckpoint {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== CHECKPOINT_VERSION) {
    throw checkpointError('Unsupported research checkpoint version. Original file preserved.');
  }
  if (!Value.Check(schema, value)) throw checkpointError('Invalid research checkpoint schema. Original file preserved.');
  const cp = value as ResearchCheckpoint;
  const ids = cp.plan.map((p) => p.capabilityId);
  const resultIds = cp.outcomes.map((o) => o.record.capabilityId);
  if (cp.summary.id !== runId || new Set(ids).size !== ids.length ||
      JSON.stringify(ids) !== JSON.stringify(cp.summary.plannedCapabilities) ||
      new Set(resultIds).size !== resultIds.length ||
      resultIds.some((id) => !ids.includes(id)) ||
      cp.outcomes.some((o) => o.record.status === 'success' && !o.result) ||
      cp.inFlight.some((id) => !ids.includes(id)) ||
      new Set(cp.inFlight).size !== cp.inFlight.length ||
      Object.keys(cp.retry.attempts).some((id) => !ids.includes(id)) ||
      Object.keys(cp.budget.limits).some((key) => !BUDGET_KEYS.includes(key as typeof BUDGET_KEYS[number])) ||
      cp.events.some((e) => e.runId !== runId || e.parentRunId !== runId)) {
    throw checkpointError('Checkpoint identity, plan or evidence is inconsistent.');
  }
  if (cp.synthesis) {
    parseSynthesisJson(JSON.stringify(cp.synthesis));
    const keys = cp.synthesis.sections.map((s) => s.key);
    if (new Set(keys).size !== keys.length || keys.length !== ids.length || keys.some((id) => !ids.includes(id))) {
      throw checkpointError('Synthesis sections do not match the saved plan.');
    }
  }
  if (cp.phase === 'publishing' && (!cp.report || !cp.synthesis)) {
    throw checkpointError('Publishing checkpoint is missing its report or synthesis.');
  }
  if (cp.report) {
    const r = cp.report;
    parseSynthesisJson(JSON.stringify(r));
    if (r.id !== 'report-' + runId || r.symbol !== cp.summary.symbol ||
        !Number.isFinite(r.generatedAt) || !['completed', 'partial', 'failed'].includes(r.runStatus) ||
        r.sections.length !== ids.length || r.sections.some((s) => !ids.includes(s.key)) ||
        !Array.isArray(r.capabilityRuns) || r.capabilityRuns.length !== ids.length ||
        new Set(r.capabilityRuns.map((c) => c.capabilityId)).size !== ids.length ||
        r.capabilityRuns.some((c) => !ids.includes(c.capabilityId)) ||
        new Set(r.sections.map((s) => s.key)).size !== r.sections.length ||
        r.sections.some((s) => !Array.isArray(s.evidence) || s.evidence.length > 1 || s.evidence.some((e) =>
          e.capabilityId !== s.key ||
          !cp.outcomes.some((o) => o.record.id === e.runId && o.record.capabilityId === e.capabilityId && o.record.status === 'success')))) {
      throw checkpointError('Checkpoint report has inconsistent evidence.');
    }
  }
  return cp;
}

export function encodeCheckpoint(cp: ResearchCheckpoint): string {
  validateCheckpoint(cp, cp.summary.id);
  const payload = JSON.stringify(cp);
  return JSON.stringify({ checksum: createHash('sha256').update(payload).digest('hex'), payload });
}

export function decodeCheckpoint(text: string, runId: string): ResearchCheckpoint {
  try {
    const envelope = JSON.parse(text);
    if (typeof envelope.payload !== 'string' ||
        createHash('sha256').update(envelope.payload).digest('hex') !== envelope.checksum) {
      throw checkpointError('Checkpoint checksum mismatch. Original file preserved.');
    }
    return validateCheckpoint(JSON.parse(envelope.payload), runId);
  } catch (error) {
    if (error instanceof Error && 'code' in error) throw error;
    throw checkpointError('Unreadable research checkpoint. Original file preserved.');
  }
}
