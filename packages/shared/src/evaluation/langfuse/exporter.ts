// Convert Folio Agent / Deep Research snapshots into a Langfuse ingestion batch.
//
// One Folio run → one Langfuse trace with child spans for retrieval/tools and
// a generation for synthesis. This is the unified tracing boundary: callers
// never import Langfuse-specific event types.
import type { PrivacyLevel, ResearchReport, ToolCallRecord } from '@finagent/core';
import { EvaluationRedactor } from '../redactor.ts';
import {
  LANGFUSE_TRACE_NAME_AGENT,
  LANGFUSE_TRACE_NAME_RESEARCH,
  langfuseMetadataRecord,
  langfuseTags,
  type FolioLangfuseMetadata,
} from './metadata.ts';
import { isoFromEpoch, newEventId, type LangfuseIngestionEvent } from './protocol.ts';

export interface AgentRunTraceSnapshot {
  folioRunId: string;
  sessionId?: string;
  threadId?: string;
  startedAt: number;
  completedAt: number;
  input?: string;
  output?: string;
  toolCalls: ToolCallRecord[];
  error?: { code: string; message: string };
  model?: string;
  provider?: string;
  usage?: { input?: number; output?: number; total?: number };
  metadata: FolioLangfuseMetadata;
}

export interface ResearchCapabilitySpan {
  capabilityId: string;
  status: string;
  startedAt?: number;
  finishedAt?: number;
  summary?: string;
  error?: string;
  provider?: string;
}

export interface ResearchRunTraceSnapshot {
  folioRunId: string;
  startedAt: number;
  completedAt: number;
  symbol: string;
  strategyId?: string;
  query?: string;
  capabilities: ResearchCapabilitySpan[];
  report?: Pick<ResearchReport, 'summary' | 'stance' | 'confidence' | 'sections' | 'bullCase' | 'bearCase' | 'risks'>;
  error?: string;
  model?: string;
  provider?: string;
  metadata: FolioLangfuseMetadata;
}

export interface BuiltTraceBatch {
  traceId: string;
  events: LangfuseIngestionEvent[];
}

export function buildAgentTraceBatch(
  snapshot: AgentRunTraceSnapshot,
  privacyLevel: PrivacyLevel = 'standard'
): BuiltTraceBatch {
  const redactor = new EvaluationRedactor(privacyLevel);
  const traceId = snapshot.folioRunId.startsWith('lf-') ? snapshot.folioRunId : snapshot.folioRunId;
  const events: LangfuseIngestionEvent[] = [];
  const started = isoFromEpoch(snapshot.startedAt);
  const ended = isoFromEpoch(snapshot.completedAt);
  const input = payload(privacyLevel, redactor.redactAnswer(snapshot.input));
  const output = payload(privacyLevel, redactor.redactAnswer(snapshot.output));

  events.push(
    event('trace-create', started, {
      id: traceId,
      name: LANGFUSE_TRACE_NAME_AGENT,
      sessionId: snapshot.sessionId ?? snapshot.threadId,
      timestamp: started,
      input,
      output,
      metadata: langfuseMetadataRecord(snapshot.metadata),
      tags: langfuseTags(snapshot.metadata),
      environment: snapshot.metadata.runKind === 'evaluation' ? 'evaluation' : 'default',
    })
  );

  for (const tool of snapshot.toolCalls) {
    const redacted = redactor.redactToolCall(tool);
    const start = isoFromEpoch(tool.startedAt);
    const end = isoFromEpoch(tool.completedAt ?? snapshot.completedAt);
    events.push(
      event('span-create', start, {
        id: newEventId(),
        traceId,
        name: `tool.${tool.toolName}`,
        startTime: start,
        endTime: end,
        input: payload(privacyLevel, redacted.args),
        output: payload(privacyLevel, redacted.result ?? redacted.error?.message),
        level: tool.status === 'error' ? 'ERROR' : 'DEFAULT',
        statusMessage: redacted.error?.message,
        metadata: { toolName: tool.toolName, status: tool.status, toolCallId: tool.id },
      })
    );
  }

  if (snapshot.model || snapshot.usage) {
    events.push(
      event('generation-create', started, {
        id: newEventId(),
        traceId,
        name: 'agent.generation',
        startTime: started,
        endTime: ended,
        model: snapshot.model,
        input,
        output,
        usage: snapshot.usage
          ? {
              input: snapshot.usage.input,
              output: snapshot.usage.output,
              total: snapshot.usage.total,
              unit: 'TOKENS',
            }
          : undefined,
        metadata: { provider: snapshot.provider },
        level: snapshot.error ? 'ERROR' : 'DEFAULT',
        statusMessage: snapshot.error ? `${snapshot.error.code}: ${snapshot.error.message}` : undefined,
      })
    );
  }

  if (snapshot.error && !snapshot.model) {
    events.push(
      event('span-create', ended, {
        id: newEventId(),
        traceId,
        name: 'agent.error',
        startTime: ended,
        endTime: ended,
        level: 'ERROR',
        statusMessage: `${snapshot.error.code}: ${snapshot.error.message}`,
        metadata: { code: snapshot.error.code },
      })
    );
  }

  return { traceId, events };
}

export function buildResearchTraceBatch(
  snapshot: ResearchRunTraceSnapshot,
  privacyLevel: PrivacyLevel = 'standard'
): BuiltTraceBatch {
  const redactor = new EvaluationRedactor(privacyLevel);
  const traceId = snapshot.folioRunId;
  const events: LangfuseIngestionEvent[] = [];
  const started = isoFromEpoch(snapshot.startedAt);
  const ended = isoFromEpoch(snapshot.completedAt);
  const query = payload(privacyLevel, redactor.redactAnswer(snapshot.query ?? snapshot.symbol));
  const reportOut = snapshot.report
    ? payload(privacyLevel, {
        summary: redactor.redactAnswer(snapshot.report.summary),
        stance: snapshot.report.stance,
        confidence: snapshot.report.confidence,
        sectionCount: snapshot.report.sections.length,
        evidenceRefs: snapshot.report.sections.reduce((sum, section) => sum + section.evidence.length, 0),
        bullCase: snapshot.report.bullCase.map((item) => redactor.redactAnswer(item)),
        bearCase: snapshot.report.bearCase.map((item) => redactor.redactAnswer(item)),
      })
    : payload(privacyLevel, snapshot.error);

  events.push(
    event('trace-create', started, {
      id: traceId,
      name: LANGFUSE_TRACE_NAME_RESEARCH,
      timestamp: started,
      input: query,
      output: reportOut,
      metadata: langfuseMetadataRecord({ ...snapshot.metadata, symbol: snapshot.symbol, strategyId: snapshot.strategyId }),
      tags: langfuseTags({ ...snapshot.metadata, symbol: snapshot.symbol, strategyId: snapshot.strategyId }),
      environment: snapshot.metadata.runKind === 'evaluation' ? 'evaluation' : 'default',
    })
  );

  events.push(
    event('span-create', started, {
      id: newEventId(),
      traceId,
      name: 'research.input',
      startTime: started,
      endTime: started,
      input: query,
      metadata: { symbol: snapshot.symbol, strategyId: snapshot.strategyId },
    })
  );

  for (const capability of snapshot.capabilities) {
    const start = isoFromEpoch(capability.startedAt ?? snapshot.startedAt);
    const end = isoFromEpoch(capability.finishedAt ?? snapshot.completedAt);
    const failed = capability.status === 'failed' || capability.status === 'unavailable';
    events.push(
      event('span-create', start, {
        id: newEventId(),
        traceId,
        name: `retrieval.${capability.capabilityId}`,
        startTime: start,
        endTime: end,
        input: payload(privacyLevel, { symbol: snapshot.symbol, capabilityId: capability.capabilityId }),
        output: payload(privacyLevel, capability.summary ?? capability.error),
        level: failed ? 'ERROR' : 'DEFAULT',
        statusMessage: capability.error,
        metadata: {
          capabilityId: capability.capabilityId,
          status: capability.status,
          provider: capability.provider,
        },
      })
    );
  }

  const synthStart = snapshot.capabilities.at(-1)?.finishedAt ?? snapshot.startedAt;
  events.push(
    event('generation-create', isoFromEpoch(synthStart), {
      id: newEventId(),
      traceId,
      name: 'research.synthesis',
      startTime: isoFromEpoch(synthStart),
      endTime: ended,
      model: snapshot.model ?? 'folio-synthesizer',
      input: payload(privacyLevel, {
        symbol: snapshot.symbol,
        capabilities: snapshot.capabilities.map((item) => item.capabilityId),
      }),
      output: reportOut,
      metadata: { provider: snapshot.provider, stance: snapshot.report?.stance },
      level: snapshot.error ? 'ERROR' : 'DEFAULT',
      statusMessage: snapshot.error,
    })
  );

  if (snapshot.report) {
    events.push(
      event('span-create', ended, {
        id: newEventId(),
        traceId,
        name: 'research.report',
        startTime: ended,
        endTime: ended,
        output: reportOut,
        metadata: {
          stance: snapshot.report.stance,
          confidence: snapshot.report.confidence,
          sections: snapshot.report.sections.map((section) => ({
            key: section.key,
            evidence: section.evidence.length,
          })),
        },
      })
    );
  }

  return { traceId, events };
}

function event(type: LangfuseIngestionEvent['type'], timestamp: string, body: Record<string, unknown>): LangfuseIngestionEvent {
  return { id: newEventId(), type, timestamp, body };
}

function payload(privacy: PrivacyLevel, value: unknown): unknown {
  if (privacy === 'minimal') return undefined;
  return value;
}
