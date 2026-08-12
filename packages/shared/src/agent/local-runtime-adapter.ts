import { randomUUID } from 'node:crypto';
import type {
  AgentEvent,
  AgentEventPayload,
  AgentRunInput,
  AgentRuntime,
  ApiResult,
  RuntimeSession,
  ToolCall,
  ToolCallRecord,
  ToolDefinition,
} from '@finagent/core';
import { LocalFinanceAgentBackend, type LocalFinanceAgentBackendOptions } from './local-finance-agent-backend.ts';

export interface LocalRuntimeAdapterOptions extends LocalFinanceAgentBackendOptions {
  backend?: LocalFinanceAgentBackend;
  now?: () => number;
}

/**
 * Local/test runtime: wraps the deterministic LocalFinanceAgentBackend in the
 * AgentRuntime contract so the full session → run → event → UI loop works
 * without a Pi process (and in tests).
 *
 * Tool calls are replayed as start/end events from the backend's own records;
 * the answer is delivered as a single message delta.
 */
export class LocalRuntimeAdapter implements AgentRuntime {
  private readonly backend: LocalFinanceAgentBackend;
  private readonly now: () => number;
  private readonly abortedRunIds = new Set<string>();
  private sequence = 0;

  constructor(options: LocalRuntimeAdapterOptions = {}) {
    this.backend = options.backend ?? new LocalFinanceAgentBackend(options);
    this.now = options.now ?? Date.now;
  }

  async getTools(): Promise<ApiResult<ToolDefinition[]>> {
    return this.backend.getTools();
  }

  async ensureSession(session: {
    id: string;
    title?: string;
    sessionPath?: string;
    recentSymbols?: string[];
  }): Promise<RuntimeSession> {
    if (session.recentSymbols && session.recentSymbols.length > 0) {
      this.backend.restoreSession(session.id, session.recentSymbols);
    }
    return { sessionId: session.id, status: 'active' };
  }

  async *run(input: AgentRunInput): AsyncIterable<AgentEvent> {
    this.sequence = 0;
    const result = await this.backend.send({
      sessionId: input.sessionId,
      content: input.content,
    });

    if (this.abortedRunIds.delete(input.runId)) {
      yield this.emit(input, 'run_failed', {
        error: { code: 'RUN_CANCELLED', message: 'Run cancelled by user.' },
      });
      return;
    }

    if (!result.ok) {
      yield this.emit(input, 'run_failed', { error: result.error });
      return;
    }

    const toolCalls: ToolCall[] = [];
    for (const record of result.data.toolCalls ?? []) {
      const toolCall = toToolCall(record);
      toolCalls.push(toolCall);
      yield this.emit(input, 'tool_started', { toolCall });
      yield this.emit(input, 'tool_completed', { toolCall });
    }

    const answer = result.data.answer || '';
    yield this.emit(input, 'message_started');
    yield this.emit(input, 'message_delta', { delta: answer, answer });
    yield this.emit(input, 'message_completed', { answer });
    yield this.emit(input, 'run_completed', { answer, toolCalls });
  }

  async cancel(input: { sessionId: string; runId: string }): Promise<void> {
    this.abortedRunIds.add(input.runId);
  }

  async disposeSession(): Promise<void> {
    // Local sessions are in-memory; nothing to release.
  }

  async dispose(): Promise<void> {
    // Nothing to release.
  }

  private emit(input: AgentRunInput, type: AgentEvent['type'], payload?: AgentEventPayload): AgentEvent {
    this.sequence += 1;
    // Call sites pair `type` with the matching payload shape.
    return {
      id: randomUUID(),
      sessionId: input.sessionId,
      runId: input.runId,
      type,
      timestamp: this.now(),
      sequence: this.sequence,
      payload,
    } as AgentEvent;
  }
}

function toToolCall(record: ToolCallRecord): ToolCall {
  return {
    id: record.id,
    toolName: record.toolName,
    args: record.args,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    status: record.status,
    result: record.result,
    error: record.error,
  };
}
