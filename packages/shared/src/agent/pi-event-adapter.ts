import { randomUUID } from 'node:crypto';
import type { AgentEvent, AgentEventPayload, ApiError, TokenUsage, ToolCall } from '@finagent/core';
import { toFiniteNumber } from '../guards.ts';

export interface PiEventAdapterOptions {
  sessionId: string;
  runId: string;
  now?: () => number;
}

/** Outcome of a consumed Pi run, reported on stream end. */
export interface AdaptedRunOutcome {
  answer: string;
  toolCalls: ToolCall[];
  aborted: boolean;
}

/**
 * Converts raw Pi JSONL events into Folio AgentEvents for one run.
 *
 * Pure mapping layer: the UI never sees Pi event shapes. The adapter is
 * stateful per run (tracks the streaming answer and live tool calls) and is
 * fed by {@link PiRpcClient.promptStreaming} via {@link consume}.
 */
export class PiEventAdapter {
  private readonly sessionId: string;
  private readonly runId: string;
  private readonly now: () => number;
  private sequence = 0;
  private readonly toolCalls = new Map<string, ToolCall>();
  /** Last execution outcome per tool name, so a re-run after an error can be marked as a retry. */
  private readonly lastToolError = new Map<string, boolean>();
  private answer = '';
  private messageStarted = false;

  constructor(options: PiEventAdapterOptions) {
    this.sessionId = options.sessionId;
    this.runId = options.runId;
    this.now = options.now ?? Date.now;
  }

  /** Feed one raw Pi event; returns the Folio events it maps to. */
  consume(event: Record<string, unknown>): AgentEvent[] {
    const type = String(event.type ?? 'unknown');

    if (type === 'tool_execution_start') {
      const toolCall = parseToolStart(event, this.now);
      this.toolCalls.set(toolCall.id, toolCall);
      const events: AgentEvent[] = [this.emit('tool_started', { toolCall })];
      // A run of the same tool right after its previous execution errored is a
      // retry: surfaced explicitly so the runaway detector can count retries.
      if (this.lastToolError.get(toolCall.toolName) === true) {
        events.push(this.emit('tool_retried', { toolCall }));
      }
      return events;
    }

    if (type === 'tool_execution_end') {
      const toolCall = parseToolEnd(event, this.now);
      const existing = this.toolCalls.get(toolCall.id);
      if (existing) {
        existing.completedAt = toolCall.completedAt;
        existing.status = toolCall.status;
        existing.result = toolCall.result;
        existing.error = toolCall.error;
      }
      const final = existing ?? toolCall;
      this.lastToolError.set(final.toolName, final.status === 'error');
      return [this.emit('tool_completed', { toolCall: final })];
    }

    if (type === 'message_update') {
      const delta = extractTextDelta(event);
      if (!delta) return [];
      this.answer += delta;
      const events: AgentEvent[] = [];
      if (!this.messageStarted) {
        this.messageStarted = true;
        events.push(this.emit('message_started'));
      }
      events.push(this.emit('message_delta', { delta, answer: this.answer }));
      return events;
    }

    if (type === 'agent_end') {
      const finalAnswer = extractFinalAnswer(event);
      if (finalAnswer) this.answer = finalAnswer;
      const events: AgentEvent[] = [];
      if (!this.messageStarted && this.answer.length > 0) {
        this.messageStarted = true;
        events.push(this.emit('message_started'));
      }
      const usage = extractProviderUsage(event);
      events.push(
        this.emit('message_completed', usage === undefined ? { answer: this.answer } : { answer: this.answer, usage })
      );
      events.push(this.emit('run_completed', { answer: this.answer, toolCalls: this.snapshotToolCalls() }));
      return events;
    }

    if (type === 'error') {
      return [this.emit('run_failed', {
        error: {
          code: 'PI_RUNTIME_ERROR',
          message: String(event.message ?? 'Pi runtime error.'),
        },
      })];
    }

    return [];
  }

  /** Terminate the run after a stream-level failure (timeout, exit, protocol). */
  fail(error: unknown): AgentEvent[] {
    return [this.emit('run_failed', { error: toApiError(error) })];
  }

  /** Terminate the run after an abort; partial answer is kept for the UI. */
  cancelled(): AgentEvent[] {
    const events: AgentEvent[] = [];
    if (this.messageStarted) {
      events.push(this.emit('message_completed', { answer: this.answer }));
    }
    events.push(this.emit('run_failed', {
      error: {
        code: 'RUN_CANCELLED',
        message: 'Run cancelled by user.',
      },
    }));
    return events;
  }

  /** Current run outcome (used when the stream ends after abort). */
  outcome(): AdaptedRunOutcome {
    return {
      answer: this.answer,
      toolCalls: this.snapshotToolCalls(),
      aborted: true,
    };
  }

  private snapshotToolCalls(): ToolCall[] {
    return Array.from(this.toolCalls.values());
  }

  private emit(type: AgentEvent['type'], payload?: AgentEventPayload): AgentEvent {
    this.sequence += 1;
    // Call sites pair `type` with the matching payload shape.
    return {
      id: randomUUID(),
      sessionId: this.sessionId,
      runId: this.runId,
      type,
      timestamp: this.now(),
      sequence: this.sequence,
      payload,
    } as AgentEvent;
  }
}

function parseToolStart(event: Record<string, unknown>, now: () => number): ToolCall {
  return {
    id: String(event.toolCallId ?? event.callId ?? event.id ?? `tool-${now()}`),
    toolName: String(event.toolName ?? event.name ?? 'unknown'),
    args: readRecord(event.args ?? event.input),
    startedAt: now(),
    status: 'running',
  };
}

function parseToolEnd(event: Record<string, unknown>, now: () => number): ToolCall {
  const errorValue = event.error;
  const rawResult = event.result ?? event.output;
  const resultRecord = readRecord(rawResult);
  const result = 'details' in resultRecord
    ? {
        data: resultRecord.details,
        ...(Object.keys(readRecord(resultRecord.provenance)).length > 0
          ? { provenance: resultRecord.provenance }
          : {}),
        ...(Object.keys(readRecord(resultRecord.evidence)).length > 0
          ? { evidence: resultRecord.evidence }
          : {}),
      }
    : rawResult;
  return {
    id: String(event.toolCallId ?? event.callId ?? event.id ?? `tool-${now()}`),
    toolName: String(event.toolName ?? event.name ?? 'unknown'),
    args: readRecord(event.args ?? event.input),
    startedAt: now(),
    completedAt: now(),
    status: event.isError || errorValue ? 'error' : 'success',
    result,
    error: errorValue
      ? { code: 'PI_TOOL_ERROR', message: String(errorValue) }
      : undefined,
  };
}

function extractTextDelta(event: Record<string, unknown>): string {
  const assistantMessageEvent = readRecord(event.assistantMessageEvent);
  if (assistantMessageEvent.type === 'text_delta' && typeof assistantMessageEvent.delta === 'string') {
    return assistantMessageEvent.delta;
  }
  return '';
}

function extractFinalAnswer(event: Record<string, unknown>): string {
  if (event.type === 'agent_end') {
    return extractAssistantTextFromMessages(event.messages);
  }
  return '';
}

function extractAssistantTextFromMessages(messages: unknown): string {
  if (!Array.isArray(messages)) return '';
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const text = extractAssistantTextFromMessageRecord(messages[index]);
    if (text) return text;
  }
  return '';
}

function extractAssistantTextFromMessageRecord(message: unknown): string {
  const record = readRecord(message);
  if (record.role !== 'assistant') return '';
  return flattenTextContent(record.content);
}

function flattenTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  const texts = content.flatMap((item) => {
    const record = readRecord(item);
    if (record.type === 'text' && typeof record.text === 'string') {
      return [record.text];
    }
    return [];
  });

  return texts.join('').trim();
}

/**
 * Normalize provider usage into {@link TokenUsage}. Pi reports it per assistant
 * message as `usage.input/output/cacheRead/cacheWrite/cost`; a runtime may also
 * report it on the event itself, and other providers use longer field names.
 * Returns undefined when nothing usable is reported, so a provider that omits
 * usage never turns into a failed run.
 */
function extractProviderUsage(event: Record<string, unknown>): TokenUsage | undefined {
  const record = readRecord(readRecord(event).usage ?? lastAssistantUsage(event));
  const input = toFiniteNumber(record.input ?? record.inputTokens ?? record.promptTokens);
  const output = toFiniteNumber(record.output ?? record.outputTokens ?? record.completionTokens);
  if (input === undefined && output === undefined) return undefined;

  const usage: TokenUsage = { inputTokens: input ?? 0, outputTokens: output ?? 0 };
  const cacheRead = toFiniteNumber(record.cacheRead ?? record.cacheReadTokens);
  if (cacheRead !== undefined) usage.cacheReadTokens = cacheRead;
  const cacheWrite = toFiniteNumber(record.cacheWrite ?? record.cacheWriteTokens);
  if (cacheWrite !== undefined) usage.cacheWriteTokens = cacheWrite;
  const cost = toFiniteNumber(record.cost ?? record.costUsd);
  if (cost !== undefined) usage.costUsd = cost;
  return usage;
}

/** Usage of the last assistant message a Pi run reported, when it carries one. */
function lastAssistantUsage(event: Record<string, unknown>): unknown {
  const messages = Array.isArray(event.messages) ? event.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = readRecord(messages[index]);
    if (message.role === 'assistant' && message.usage !== undefined) return message.usage;
  }
  return undefined;
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toApiError(error: unknown): ApiError {
  if (error instanceof Error && typeof (error as { code?: unknown }).code === 'string') {
    const codeError = error as Error & { code: string; action?: string };
    return {
      code: codeError.code,
      message: codeError.message,
      action: codeError.action,
    };
  }
  if (error instanceof Error) {
    return { code: 'UNKNOWN_ERROR', message: error.message };
  }
  return { code: 'UNKNOWN_ERROR', message: String(error) };
}
