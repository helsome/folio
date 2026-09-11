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
  RuntimeSession,
  ToolDefinition,
} from '@finagent/core';
import { AgentKernel } from './agent-kernel.ts';

let dir = '';
let clock = 1000;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'finagent-kernel-budget-'));
  clock = 1000;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

class ScriptedRuntime implements AgentRuntime {
  cancelCalls: Array<{ sessionId: string; runId: string }> = [];

  constructor(private readonly script: (input: AgentRunInput) => AsyncIterable<AgentEvent>) {}

  async getTools(): Promise<ApiResult<ToolDefinition[]>> {
    return { ok: true, data: [] };
  }

  async ensureSession(session: { id: string }): Promise<RuntimeSession> {
    return { sessionId: session.id, status: 'active' };
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

/** Two model calls, then a normal completion — over-budget only when a budget says so. */
function twoStepScript(answer: string) {
  return async function* (input: AgentRunInput) {
    yield event(input.sessionId, input.runId, 'message_completed', { answer }, 1);
    yield event(input.sessionId, input.runId, 'message_completed', { answer }, 2);
    yield event(input.sessionId, input.runId, 'run_completed', { answer, toolCalls: [] }, 3);
  };
}

describe('AgentKernel run budgets (#17)', () => {
  it('forwards budget options to the run loop so a real run can be stopped', async () => {
    const runtime = new ScriptedRuntime(twoStepScript('partial'));
    const kernel = new AgentKernel({
      storageDir: dir,
      piSessionDir: join(dir, 'pi-sessions'),
      runtime,
      now: () => clock,
      budgets: { defaults: { modelCalls: 1 } },
    });
    const session = await kernel.sessions.createSession('Budget');

    const run = await kernel.runs.startRun(session.id, 'q');
    await waitFor(async () => !kernel.runs.isRunning());

    expect(runtime.cancelCalls).toEqual([{ sessionId: session.id, runId: run.id }]);
    expect(await kernel.sessions.getRun(session.id, run.id)).toMatchObject({
      status: 'cancelled',
      answer: 'partial',
      stopReason: 'budget_exhausted',
      stopDetail: { key: 'modelCalls', limit: 1, used: 1 },
    });
  });

  it('runs the same script to completion when no budget is configured', async () => {
    const runtime = new ScriptedRuntime(twoStepScript('done'));
    const kernel = new AgentKernel({
      storageDir: dir,
      piSessionDir: join(dir, 'pi-sessions'),
      runtime,
      now: () => clock,
    });
    const session = await kernel.sessions.createSession('Plain');

    const run = await kernel.runs.startRun(session.id, 'q');
    await waitFor(async () => !kernel.runs.isRunning());

    expect(runtime.cancelCalls).toEqual([]);
    expect(await kernel.sessions.getRun(session.id, run.id)).toMatchObject({
      status: 'completed',
      answer: 'done',
    });
  });

  it('forwards runaway detector thresholds for repeated tool calls', async () => {
    const runtime = new ScriptedRuntime(async function* (input) {
      for (let i = 1; i <= 3; i += 1) {
        yield event(
          input.sessionId,
          input.runId,
          'tool_completed',
          {
            toolCall: {
              id: `t${i}`,
              toolName: 'get_quote',
              args: { symbol: 'AAPL.US' },
              startedAt: clock,
              completedAt: clock,
              status: 'success',
              result: {},
            },
          },
          i
        );
      }
      yield event(input.sessionId, input.runId, 'run_completed', { answer: 'done', toolCalls: [] }, 9);
    });
    const kernel = new AgentKernel({
      storageDir: dir,
      piSessionDir: join(dir, 'pi-sessions'),
      runtime,
      now: () => clock,
      runaway: { repeatedToolCallThreshold: 2 },
    });
    const session = await kernel.sessions.createSession('Loop');

    const run = await kernel.runs.startRun(session.id, 'q');
    await waitFor(async () => !kernel.runs.isRunning());

    expect(await kernel.sessions.getRun(session.id, run.id)).toMatchObject({
      status: 'cancelled',
      stopReason: 'loop_detected',
    });
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
