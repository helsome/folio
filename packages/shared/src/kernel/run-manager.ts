import { randomUUID } from 'node:crypto';
import type {
  AgentEvent,
  AgentEventPayload,
  AgentRuntime,
  ApiError,
  Message,
  Run,
  SessionMeta,
  ToolCall,
  ToolCallRecord,
} from '@finagent/core';
import type { RunRepository } from '../storage/index.ts';
import type { SessionManager } from './session-manager.ts';
import { createCodeError, toApiError } from '../agent/errors.ts';

export interface RunManagerOptions {
  sessions: SessionManager;
  runs: RunRepository;
  runtime: AgentRuntime;
  now?: () => number;
}

interface ActiveRun {
  sessionId: string;
  runId: string;
  cancelRequested: boolean;
}

/**
 * Starts, observes, persists, and terminates runs.
 *
 * Each run: persists the user message and the run record, drives the runtime's
 * event stream, broadcasts every AgentEvent to subscribers (the Electron main
 * process forwards them to the UI), persists the final assistant message and
 * run outcome, and guarantees the run never stays `running`: every terminal
 * path (completed, failed, cancelled, runtime crash, timeout) settles it.
 */
export class RunManager {
  private readonly sessions: SessionManager;
  private readonly runs: RunRepository;
  private readonly runtime: AgentRuntime;
  private readonly now: () => number;
  private readonly listeners = new Set<(event: AgentEvent) => void>();
  private activeRun: ActiveRun | null = null;

  constructor(options: RunManagerOptions) {
    this.sessions = options.sessions;
    this.runs = options.runs;
    this.runtime = options.runtime;
    this.now = options.now ?? Date.now;
  }

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Whether a run is currently executing (Pi runtime executes one at a time). */
  isRunning(): boolean {
    return this.activeRun !== null;
  }

  /** Whether a run is currently executing for the given session. */
  hasActiveRun(sessionId: string): boolean {
    return this.activeRun?.sessionId === sessionId;
  }

  async startRun(sessionId: string, content: string): Promise<Run> {
    const text = content.trim();
    if (!text) {
      throw createCodeError('INVALID_ARGUMENT', 'Message content is required.');
    }
    if (this.activeRun) {
      throw createCodeError(
        'RUN_IN_PROGRESS',
        'Another run is still in progress. Stop it before sending a new message.'
      );
    }

    const session = await this.sessions.getSession(sessionId);
    if (!session) {
      throw createCodeError('SESSION_NOT_FOUND', `Session ${sessionId} was not found.`);
    }

    const now = this.now();
    const run: Run = {
      id: randomUUID(),
      sessionId,
      status: 'running',
      input: text,
      startedAt: now,
    };
    await this.runs.create(run);

    const userMessage: Message = {
      id: randomUUID(),
      role: 'user',
      content: text,
      timestamp: now,
    };
    await this.sessions.appendMessage(sessionId, userMessage);
    await this.sessions.updateSession(sessionId, { status: 'running' });

    this.activeRun = { sessionId, runId: run.id, cancelRequested: false };
    this.emit({
      id: randomUUID(),
      sessionId,
      runId: run.id,
      type: 'run_started',
      timestamp: now,
      sequence: 1,
      payload: { run, userMessage },
    });

    void this.execute(run, session);
    return run;
  }

  /** Abort the given run if it is the one currently executing. */
  async cancelRun(sessionId: string, runId: string): Promise<void> {
    const active = this.activeRun;
    if (!active || active.sessionId !== sessionId || active.runId !== runId) {
      return;
    }
    active.cancelRequested = true;
    await this.runtime.cancel({ sessionId, runId });
  }

  private async execute(run: Run, session: SessionMeta): Promise<void> {
    let failure: ApiError | undefined;
    let answer = '';
    const toolCalls: ToolCall[] = [];
    let sawTerminal = false;

    try {
      await this.runtime.ensureSession({
        id: run.sessionId,
        title: session.title,
        sessionPath: session.runtimeSessionPath,
        recentSymbols: session.recentSymbols,
      });

      for await (const event of this.runtime.run({
        sessionId: run.sessionId,
        runId: run.id,
        content: run.input,
      })) {
        this.emit(event);
        if (event.type === 'message_delta' || event.type === 'message_completed') {
          answer = event.payload.answer;
        } else if (event.type === 'tool_completed') {
          toolCalls.push(event.payload.toolCall);
        } else if (event.type === 'run_failed') {
          failure = event.payload.error;
          sawTerminal = true;
        } else if (event.type === 'run_completed') {
          answer = event.payload.answer;
          sawTerminal = true;
        }
      }
    } catch (error) {
      failure = toApiError(error);
    }

    const active = this.activeRun;
    const cancelRequested = active?.cancelRequested ?? false;

    const now = this.now();
    const cancelled = Boolean(cancelRequested || (failure && failure.code === 'RUN_CANCELLED'));

    if (cancelled) {
      run.status = 'cancelled';
      run.answer = answer;
    } else if (failure) {
      run.status = 'failed';
      run.error = failure;
      run.answer = answer;
    } else {
      run.status = 'completed';
      run.answer = answer;
    }
    run.completedAt = now;

    await this.runs.update(run);

    const assistantMessage: Message = {
      id: randomUUID(),
      role: 'assistant',
      content: answer || (run.status === 'failed' ? run.error?.message ?? 'Run failed.' : ''),
      timestamp: now,
      toolCalls: toolCalls.map(toRecord),
    };
    await this.sessions.appendMessage(run.sessionId, assistantMessage);
    await this.sessions.updateSession(run.sessionId, {
      status: 'idle',
      recentSymbols: collectSymbols(toolCalls),
    });

    // The run is fully settled (persisted) only now; only then allow the next run.
    this.activeRun = null;

    // Adapters emit the terminal event themselves; synthesize it only when the
    // stream failed before producing one (e.g. runtime spawn failure), so the
    // UI always observes a terminal event.
    if (!sawTerminal) {
      if (cancelled) {
        this.emitRunEvent(run, 'run_failed', {
          error: { code: 'RUN_CANCELLED', message: 'Run cancelled by user.' },
        });
      } else if (failure) {
        this.emitRunEvent(run, 'run_failed', { error: failure });
      } else {
        this.emitRunEvent(run, 'run_completed', { answer, toolCalls });
      }
    }
  }

  private emitRunEvent(run: Run, type: AgentEvent['type'], payload?: AgentEventPayload): void {
    // Callers pair `type` with the matching payload shape.
    const event = {
      id: randomUUID(),
      sessionId: run.sessionId,
      runId: run.id,
      type,
      timestamp: this.now(),
      sequence: 1,
      payload,
    } as AgentEvent;
    this.emit(event);
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

function toRecord(toolCall: ToolCall): ToolCallRecord {
  return {
    id: toolCall.id,
    toolName: toolCall.toolName,
    args: toolCall.args,
    startedAt: toolCall.startedAt,
    completedAt: toolCall.completedAt,
    status: toolCall.status === 'error' ? 'error' : 'success',
    result: toolCall.result,
    error: toolCall.error,
  };
}

function collectSymbols(toolCalls: ToolCall[]): string[] {
  const symbols: string[] = [];
  for (const toolCall of toolCalls) {
    const symbol = typeof toolCall.args.symbol === 'string' ? toolCall.args.symbol.toUpperCase() : undefined;
    if (symbol && !symbols.includes(symbol)) {
      symbols.push(symbol);
    }
  }
  return symbols.slice(0, 5);
}
