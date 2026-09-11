import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type {
  AgentEvent,
  AgentEventPayload,
  AgentRunInput,
  AgentRuntime,
  ApiResult,
  RuntimeBranchPreparationInput,
  RuntimeBranchState,
  RuntimeRunArtifacts,
  RuntimeSession,
  ToolDefinition,
} from '@finagent/core';
import { BranchRepository } from '../storage/branch-repository.ts';
import { JsonFileStore } from '../storage/json-file-store.ts';
import { MessageRepository } from '../storage/message-repository.ts';
import { RunRepository } from '../storage/run-repository.ts';
import { SessionRepository } from '../storage/session-repository.ts';
import { SessionManager } from './session-manager.ts';
import { RunManager, type RunManagerOptions } from './run-manager.ts';

let dir = '';
let clock = 1000;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'finagent-kernel-'));
  clock = 1000;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function makeKernel(
  script: (input: AgentRunInput) => AsyncIterable<AgentEvent>,
  nativeBranchOrExtra: boolean | Partial<Omit<RunManagerOptions, 'sessions' | 'runs' | 'runtime' | 'now'>> = false,
  maybeExtra: Partial<Omit<RunManagerOptions, 'sessions' | 'runs' | 'runtime' | 'now'>> = {}
) {
  const nativeBranch = typeof nativeBranchOrExtra === 'boolean' ? nativeBranchOrExtra : false;
  const extra = typeof nativeBranchOrExtra === 'boolean' ? maybeExtra : nativeBranchOrExtra;
  const runtime = new ScriptedRuntime(script, nativeBranch);
  const store = new JsonFileStore(dir);
  const sessions = new SessionManager({
    sessions: new SessionRepository(store),
    messages: new MessageRepository(store),
    runs: new RunRepository(store),
    branches: new BranchRepository(store),
    piSessionDir: join(dir, 'pi-sessions'),
    now: () => clock,
  });
  const runs = new RunManager({
    sessions,
    runs: new RunRepository(store),
    runtime,
    now: () => clock,
    ...extra,
  });
  return { runtime, sessions, runs, store };
}

class ScriptedRuntime implements AgentRuntime {
  ensureSessionCalls: Array<{ id: string; branchId?: string; sessionPath?: string }> = [];
  prepareBranchCalls: RuntimeBranchPreparationInput[] = [];
  cancelCalls: Array<{ sessionId: string; runId: string }> = [];

  constructor(
    private readonly script: (input: AgentRunInput) => AsyncIterable<AgentEvent>,
    private readonly nativeBranch: boolean
  ) {}

  async getTools(): Promise<ApiResult<ToolDefinition[]>> {
    return { ok: true, data: [] };
  }

  async ensureSession(session: {
    id: string;
    title?: string;
    branchId?: string;
    sessionPath?: string;
  }): Promise<RuntimeSession> {
    this.ensureSessionCalls.push(session);
    return { sessionId: session.id, status: 'active' };
  }

  async prepareBranch(input: RuntimeBranchPreparationInput): Promise<RuntimeBranchState> {
    if (!this.nativeBranch) return {};
    this.prepareBranchCalls.push(input);
    return {
      runtimeSessionPath: `/runtime/${input.branchId}.jsonl`,
      runtimeSessionId: `pi-${input.branchId}`,
      runtimeLeafId: `leaf-${input.branchId}`,
    };
  }

  async getRunArtifacts(input: { sessionId: string; runId: string }): Promise<RuntimeRunArtifacts | undefined> {
    if (!this.nativeBranch) return undefined;
    return {
      runtimeSessionId: `pi-${input.sessionId}`,
      runtimeSessionPath: `/runtime/${input.runId}.jsonl`,
      runtimeLeafId: `leaf-${input.runId}`,
      runtimeUserEntryId: `user-${input.runId}`,
      runtimeAssistantEntryId: `assistant-${input.runId}`,
    };
  }

  async *run(input: AgentRunInput): AsyncIterable<AgentEvent> {
    yield* this.script(input);
  }

  async cancel(input: { sessionId: string; runId: string }): Promise<void> {
    this.cancelCalls.push(input);
  }

  async dispose(): Promise<void> {}
}

function event(
  sessionId: string,
  runId: string,
  type: AgentEvent['type'],
  payload?: AgentEventPayload,
  sequence = 1
): AgentEvent {
  return {
    id: `evt-${type}-${sequence}`,
    sessionId,
    runId,
    type,
    timestamp: clock,
    sequence,
    ...(payload === undefined ? {} : { payload }),
  } as unknown as AgentEvent;
}

function completedScript(answer: string): (input: AgentRunInput) => AsyncIterable<AgentEvent> {
  return async function* (input) {
    yield event(input.sessionId, input.runId, 'tool_started', {
      toolCall: { id: 't1', toolName: 'get_portfolio', args: {}, startedAt: clock, status: 'running' },
    });
    yield event(input.sessionId, input.runId, 'tool_completed', {
      toolCall: { id: 't1', toolName: 'get_portfolio', args: {}, startedAt: clock, completedAt: clock, status: 'success', result: {} },
    });
    yield event(input.sessionId, input.runId, 'message_started');
    yield event(input.sessionId, input.runId, 'message_delta', { delta: answer, answer });
    yield event(input.sessionId, input.runId, 'message_completed', { answer });
    yield event(input.sessionId, input.runId, 'run_completed', { answer, toolCalls: [] });
  };
}

describe('RunManager', () => {
  it('runs a full loop: run_started → tools → deltas → run_completed, persisted', async () => {
    const { sessions, runs, runtime } = makeKernel(completedScript('Portfolio risk is moderate.'));
    const session = await sessions.createSession('Portfolio Review');

    const run = await runs.startRun(session.id, '分析一下我当前持仓最大的风险');

    expect(run.status).toBe('running');

    // Wait for the background execution to finish.
    await waitFor(async () => !runs.isRunning());

    const persistedRun = await sessions.getRun(session.id, run.id);
    expect(persistedRun).toMatchObject({ status: 'completed', answer: 'Portfolio risk is moderate.' });

    const messages = await sessions.listMessages(session.id);
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(messages[0]).toMatchObject({ content: '分析一下我当前持仓最大的风险' });
    expect(messages[1]).toMatchObject({ content: 'Portfolio risk is moderate.' });

    const updated = await sessions.getSession(session.id);
    expect(updated?.status).toBe('idle');
    expect(updated?.messageCount).toBe(2);
    expect(runtime.ensureSessionCalls[0]).toMatchObject({ id: session.id });
  });

  it('broadcasts the agent event sequence to subscribers', async () => {
    const { sessions, runs } = makeKernel(completedScript('Answer A'));
    const session = await sessions.createSession('A');
    const types: string[] = [];

    const unsubscribe = runs.subscribe((agentEvent) => types.push(agentEvent.type));
    await runs.startRun(session.id, 'question');
    await waitFor(async () => !runs.isRunning());
    unsubscribe();

    expect(types).toEqual([
      'run_started',
      'tool_started',
      'tool_completed',
      'message_started',
      'message_delta',
      'message_completed',
      'run_completed',
    ]);
  });

  it('persists failed runs with the error (infra failures skip the chat message, V8.1 §38–39)', async () => {
    const { sessions, runs } = makeKernel(async function* (input) {
      yield event(input.sessionId, input.runId, 'run_failed', {
        error: { code: 'PI_RUNTIME_EXITED', message: 'Pi runtime exited with code 1.' },
      });
    });
    const session = await sessions.createSession('A');

    const run = await runs.startRun(session.id, 'hello');
    await waitFor(async () => !runs.isRunning());

    const persistedRun = await sessions.getRun(session.id, run.id);
    expect(persistedRun?.status).toBe('failed');
    expect(persistedRun?.error?.code).toBe('PI_RUNTIME_EXITED');

    // A runtime infrastructure failure is NOT an answer: it must not spam the
    // conversation with an assistant-style "Pi runtime exited" message. Only
    // the user message lives on; the panel renders a dedicated banner instead.
    const messages = await sessions.listMessages(session.id);
    expect(messages.map((m) => m.role)).toEqual(['user']);
  });

  it('still persists an assistant message for non-infrastructure failures', async () => {
    const { sessions, runs } = makeKernel(async function* (input) {
      yield event(input.sessionId, input.runId, 'run_failed', {
        error: { code: 'TOOL_EXECUTION_ERROR', message: 'get_quote failed: rate limited.' },
      });
    });
    const session = await sessions.createSession('A');
    await runs.startRun(session.id, 'check NVDA');
    await waitFor(async () => !runs.isRunning());
    const messages = await sessions.listMessages(session.id);
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(messages[1].content).toContain('get_quote failed');
  });

  it('cancels a running run and marks it cancelled', async () => {
    let releaseCancel: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseCancel = resolve;
    });
    const { sessions, runs, runtime } = makeKernel(async function* (input) {
      yield event(input.sessionId, input.runId, 'message_started');
      await gate;
      yield event(input.sessionId, input.runId, 'message_delta', { delta: 'partial', answer: 'partial' });
      yield event(input.sessionId, input.runId, 'run_failed', {
        error: { code: 'RUN_CANCELLED', message: 'Run cancelled by user.' },
      });
    });
    const session = await sessions.createSession('A');

    const run = await runs.startRun(session.id, 'long task');
    await waitFor(async () => runtime.ensureSessionCalls.length === 1);
    await runs.cancelRun(session.id, run.id);
    releaseCancel?.();
    await waitFor(async () => !runs.isRunning());

    expect(runtime.cancelCalls).toEqual([{ sessionId: session.id, runId: run.id }]);
    const persistedRun = await sessions.getRun(session.id, run.id);
    expect(persistedRun?.status).toBe('cancelled');
    expect(persistedRun?.answer).toBe('partial');
    expect((await sessions.getSession(session.id))?.status).toBe('idle');
  });

  it('rejects a second run while one is in progress', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const { sessions, runs } = makeKernel(async function* (input) {
      yield event(input.sessionId, input.runId, 'message_started');
      await firstGate;
    });
    const session = await sessions.createSession('A');

    await runs.startRun(session.id, 'first');
    await expect(runs.startRun(session.id, 'second')).rejects.toMatchObject({
      code: 'RUN_IN_PROGRESS',
    });
    releaseFirst?.();
    await waitFor(async () => !runs.isRunning());
  });

  it('keeps session context isolated across sessions', async () => {
    const { sessions, runs } = makeKernel((input) =>
      completedScript(input.sessionId === sessionA.id ? 'Answer for A' : 'Answer for B')(input)
    );
    const sessionA = await sessions.createSession('A');
    const sessionB = await sessions.createSession('B');

    await runs.startRun(sessionA.id, 'q1');
    await waitFor(async () => !runs.isRunning());
    await runs.startRun(sessionB.id, 'q2');
    await waitFor(async () => !runs.isRunning());

    const messagesA = await sessions.listMessages(sessionA.id);
    const messagesB = await sessions.listMessages(sessionB.id);
    expect(messagesA[1].content).toBe('Answer for A');
    expect(messagesB[1].content).toBe('Answer for B');
    expect(messagesA).not.toEqual(messagesB);
  });

  it('fails the run when the runtime stream throws (process crash)', async () => {
    const { sessions, runs } = makeKernel(async function* () {
      throw Object.assign(new Error('Pi runtime exited with code 1.'), { code: 'PI_RUNTIME_EXITED' });
    });
    const session = await sessions.createSession('A');
    const types: string[] = [];
    runs.subscribe((agentEvent) => types.push(agentEvent.type));

    const run = await runs.startRun(session.id, 'hello');
    await waitFor(async () => !runs.isRunning());

    const persistedRun = await sessions.getRun(session.id, run.id);
    expect(persistedRun?.status).toBe('failed');
    expect(persistedRun?.error?.code).toBe('PI_RUNTIME_EXITED');
    expect(types).toContain('run_failed');
  });

  it('rejects runs for unknown sessions', async () => {
    const { runs } = makeKernel(completedScript('x'));
    await expect(runs.startRun('missing', 'hello')).rejects.toMatchObject({
      code: 'SESSION_NOT_FOUND',
    });
  });

  it('regenerates without duplicating the inherited user message or overwriting the old answer', async () => {
    const { sessions, runs } = makeKernel((input) => completedScript(`answer-${input.runId}`)(input));
    const session = await sessions.createSession('A');

    await runs.startRun(session.id, 'compare NVDA');
    await waitFor(async () => !runs.isRunning());
    const originalMessages = await sessions.listMessages(session.id);
    const originalAnswer = originalMessages[1];
    const regenerated = await runs.regenerateMessage(session.id, originalAnswer.id);
    await waitFor(async () => !runs.isRunning());

    const branches = await sessions.listBranches(session.id);
    expect(branches).toHaveLength(2);
    expect(regenerated.operation).toBe('regenerate');
    expect(regenerated.parentRunId).toBeTruthy();
    expect(regenerated.manifest).toMatchObject({ operation: 'regenerate', toolCallIds: ['t1'] });
    expect((await sessions.listMessages(session.id)).map((message) => message.id)).toEqual([
      originalMessages[0].id,
      `assistant-${regenerated.id}`,
    ]);
    expect((await sessions.listAllMessages(session.id)).map((message) => message.id)).toEqual([
      originalMessages[0].id,
      originalAnswer.id,
      `assistant-${regenerated.id}`,
    ]);
  });

  it('edits from the selected historical point and excludes later answers from the new branch', async () => {
    const { sessions, runs } = makeKernel(completedScript('answer'));
    const session = await sessions.createSession('A');

    await runs.startRun(session.id, 'first question');
    await waitFor(async () => !runs.isRunning());
    await runs.startRun(session.id, 'second question');
    await waitFor(async () => !runs.isRunning());
    const original = await sessions.listMessages(session.id);
    const editedRun = await runs.editMessage(session.id, original[2].id, 'edited second question');
    await waitFor(async () => !runs.isRunning());

    expect(editedRun.operation).toBe('edit');
    expect(editedRun.sourceMessageId).toBe(original[2].id);
    expect((await sessions.listMessages(session.id)).map((message) => message.content)).toEqual([
      'first question',
      'answer',
      'edited second question',
      'answer',
    ]);
    expect((await sessions.listMessages(session.id)).some((message) => message.content === 'second question')).toBe(false);
  });

  it('retries only failed runs and creates a new generation on a child branch', async () => {
    let attempts = 0;
    const { sessions, runs } = makeKernel(async function* (input) {
      attempts += 1;
      if (attempts === 1) {
        yield event(input.sessionId, input.runId, 'run_failed', {
          error: { code: 'TOOL_EXECUTION_ERROR', message: 'temporary failure' },
        });
        return;
      }
      yield* completedScript('retried answer')(input);
    });
    const session = await sessions.createSession('A');

    const failed = await runs.startRun(session.id, 'retry me');
    await waitFor(async () => !runs.isRunning());
    const retried = await runs.retryRun(session.id, failed.id);
    await waitFor(async () => !runs.isRunning());

    expect(retried.operation).toBe('retry');
    expect(retried.parentRunId).toBe(failed.id);
    expect(retried.id).not.toBe(failed.id);
    expect((await sessions.listMessages(session.id)).map((message) => message.content)).toEqual([
      'retry me',
      'retried answer',
    ]);
    await expect(runs.retryRun(session.id, retried.id)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('forks from an earlier message and keeps the fork cursor after reload', async () => {
    const { sessions, runs } = makeKernel(completedScript('answer'));
    const session = await sessions.createSession('A');
    await runs.startRun(session.id, 'first');
    await waitFor(async () => !runs.isRunning());
    await runs.startRun(session.id, 'second');
    await waitFor(async () => !runs.isRunning());
    const original = await sessions.listMessages(session.id);

    const branch = await runs.forkBranch(session.id, original[1].id, 'Research alternative');
    expect(branch.parentBranchId).toBeTruthy();
    expect((await sessions.listMessages(session.id)).map((message) => message.content)).toEqual(['first', 'answer']);

    await runs.startRun(session.id, 'alternative question');
    await waitFor(async () => !runs.isRunning());
    const reloaded = new SessionRepository(new JsonFileStore(dir));
    expect((await reloaded.get(session.id))?.activeBranchId).toBe(branch.id);
    expect((await sessions.listMessages(session.id)).map((message) => message.content)).toEqual([
      'first',
      'answer',
      'alternative question',
      'answer',
    ]);
  });
});

describe('RunManager budgets and runaway detection (#17)', () => {
  const toolEvent = (
    input: AgentRunInput,
    toolName: string,
    args: Record<string, unknown>,
    sequence: number
  ) =>
    event(
      input.sessionId,
      input.runId,
      'tool_completed',
      {
        toolCall: {
          id: `t${sequence}`,
          toolName,
          args,
          startedAt: clock,
          completedAt: clock,
          status: 'success',
          result: {},
        },
      },
      sequence
    );

  it('stops a run that exceeds its model-call budget and keeps the partial answer', async () => {
    const { sessions, runs, runtime } = makeKernel(
      async function* (input) {
        yield event(input.sessionId, input.runId, 'message_completed', { answer: 'partial one' }, 1);
        yield event(input.sessionId, input.runId, 'message_completed', { answer: 'partial two' }, 2);
        yield event(input.sessionId, input.runId, 'run_completed', { answer: 'finished', toolCalls: [] }, 3);
      },
      { budgets: { defaults: { modelCalls: 2 } } }
    );
    const session = await sessions.createSession('Budget');

    const run = await runs.startRun(session.id, 'long task');
    await waitFor(async () => !runs.isRunning());

    expect(runtime.cancelCalls).toEqual([{ sessionId: session.id, runId: run.id }]);
    const persisted = await sessions.getRun(session.id, run.id);
    expect(persisted).toMatchObject({
      status: 'cancelled',
      answer: 'partial two',
      stopReason: 'budget_exhausted',
      stopDetail: { key: 'modelCalls', limit: 2, used: 2 },
    });
    const messages = await sessions.listMessages(session.id);
    expect(messages[1]).toMatchObject({ role: 'assistant', content: 'partial two' });
  });

  it('lets a run tighten its own budget but clamps it to the system ceiling', async () => {
    const script = async function* (input: AgentRunInput) {
      yield event(input.sessionId, input.runId, 'message_completed', { answer: 'one' }, 1);
      yield event(input.sessionId, input.runId, 'run_completed', { answer: 'one', toolCalls: [] }, 2);
    };
    const { sessions, runs, runtime } = makeKernel(script, {
      budgets: { defaults: { modelCalls: 10 }, ceiling: { modelCalls: 5 } },
    });
    const session = await sessions.createSession('Override');

    const tightened = await runs.startRun(session.id, 'q', undefined, undefined, { modelCalls: 1 });
    await waitFor(async () => !runs.isRunning());
    expect(runtime.cancelCalls).toEqual([{ sessionId: session.id, runId: tightened.id }]);
    expect(await sessions.getRun(session.id, tightened.id)).toMatchObject({
      stopReason: 'budget_exhausted',
      stopDetail: { key: 'modelCalls', limit: 1, used: 1 },
    });

    const clamped = await runs.startRun(session.id, 'q', undefined, undefined, { modelCalls: 100 });
    await waitFor(async () => !runs.isRunning());
    expect(runtime.cancelCalls).toHaveLength(1);
    expect(await sessions.getRun(session.id, clamped.id)).toMatchObject({ status: 'completed' });
  });

  it('stops on a repeated identical tool call and reports loop_detected', async () => {
    const { sessions, runs, runtime } = makeKernel(
      async function* (input) {
        for (let i = 1; i <= 3; i += 1) {
          yield toolEvent(input, 'get_quote', { symbol: 'AAPL.US' }, i);
        }
        yield event(input.sessionId, input.runId, 'run_completed', { answer: 'done', toolCalls: [] }, 9);
      },
      { runaway: { repeatedToolCallThreshold: 2 } }
    );
    const session = await sessions.createSession('Loop');

    const run = await runs.startRun(session.id, 'q');
    await waitFor(async () => !runs.isRunning());

    expect(runtime.cancelCalls).toHaveLength(1);
    const persisted = await sessions.getRun(session.id, run.id);
    expect(persisted).toMatchObject({ status: 'cancelled', stopReason: 'loop_detected' });
    expect(persisted?.stopDetail).toMatchObject({
      signal: 'repeated_tool_call',
      tool: 'get_quote',
      count: 2,
    });
  });

  it('stops on a repeated search query once search tools are configured', async () => {
    const { sessions, runs } = makeKernel(
      async function* (input) {
        yield toolEvent(input, 'web_search', { query: 'nvidia earnings 2026' }, 1);
        yield toolEvent(input, 'web_search', { query: 'nvidia earnings 2026 q2' }, 2);
        yield event(input.sessionId, input.runId, 'run_completed', { answer: 'done', toolCalls: [] }, 9);
      },
      { searchTools: ['web_search*'], runaway: { repeatedSearchQueryThreshold: 2 } }
    );
    const session = await sessions.createSession('Search');

    const run = await runs.startRun(session.id, 'q');
    await waitFor(async () => !runs.isRunning());

    const persisted = await sessions.getRun(session.id, run.id);
    expect(persisted).toMatchObject({ stopReason: 'loop_detected' });
    expect(persisted?.stopDetail).toMatchObject({ signal: 'repeated_search_query', count: 2 });
  });

  it('stops on the wall-clock budget measured with the injected clock', async () => {
    const { sessions, runs } = makeKernel(
      async function* (input) {
        clock += 5_000;
        yield event(input.sessionId, input.runId, 'message_completed', { answer: 'slow step' }, 1);
        yield event(input.sessionId, input.runId, 'run_completed', { answer: 'done', toolCalls: [] }, 2);
      },
      { budgets: { defaults: { wallClockMs: 1_000 } } }
    );
    const session = await sessions.createSession('Clock');

    const run = await runs.startRun(session.id, 'q');
    await waitFor(async () => !runs.isRunning());

    expect(await sessions.getRun(session.id, run.id)).toMatchObject({
      stopReason: 'budget_exhausted',
      stopDetail: { key: 'wallClockMs', limit: 1_000, used: 5_000 },
    });
  });

  it('leaves a run untouched when neither budgets nor detectors are configured', async () => {
    const { sessions, runs, runtime } = makeKernel(completedScript('Answer'));
    const session = await sessions.createSession('Plain');

    const run = await runs.startRun(session.id, 'q');
    await waitFor(async () => !runs.isRunning());

    expect(runtime.cancelCalls).toEqual([]);
    const persisted = await sessions.getRun(session.id, run.id);
    expect(persisted).toMatchObject({ status: 'completed', answer: 'Answer' });
    expect(persisted?.stopReason).toBeUndefined();
  });
});

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 2000) {
  const started = Date.now();
  while (!(await predicate())) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('waitFor timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
