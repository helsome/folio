import { randomUUID } from 'node:crypto';
import type { AgentEvent, AgentEventPayload, ApiError, ToolCall } from '@finagent/core';

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
      return [this.emit('tool_started', { toolCall })];
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
      return [this.emit('tool_completed', { toolCall: existing ?? toolCall })];
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
      events.push(this.emit('message_completed', { answer: this.answer }));
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
  return {
    id: String(event.toolCallId ?? event.callId ?? event.id ?? `tool-${now()}`),
    toolName: String(event.toolName ?? event.name ?? 'unknown'),
    args: readRecord(event.args ?? event.input),
    startedAt: now(),
    completedAt: now(),
    status: event.isError || errorValue ? 'error' : 'success',
    result: event.result ?? event.output,
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
