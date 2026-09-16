// Stream Event Protocol v1 — replay 全链路 E2E（issue #27）。
//
// 与 stream-history.test.ts（纯内存历史单测）不同，这里走真实运行链路：
// RunManager + LocalRuntimeAdapter（FINAGENT_AGENT_PROVIDER=local 时 E2E
// 使用的同一 runtime）+ 真实持久化仓储，验证 ADR 0001 的 replay 契约：
//   1. sequence 每 run 严格单调 +1（所有生产者共同遵守的协议契约）；
//   2. 无实时订阅者时事件仍入历史（reconnect 的数据源保证）；
//   3. 中途“断线”后按 lastSequence 补发，拼接结果与全量一致；
//   4. 取消路径产生显式 cancelled 事件且可补发（atEnd=true）；
//   5. message/run 双身份：message 级事件带 messageId，run 级不带（#34）。

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { StreamEvent, ToolDefinition } from '@finagent/core';
import { LocalRuntimeAdapter } from '../agent/local-runtime-adapter.ts';
import { JsonFileStore } from '../storage/json-file-store.ts';
import { MessageRepository } from '../storage/message-repository.ts';
import { RunRepository } from '../storage/run-repository.ts';
import { SessionRepository } from '../storage/session-repository.ts';
import { SessionManager } from './session-manager.ts';
import { RunManager } from './run-manager.ts';

let dir = '';
let clock = 1000;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'finagent-stream-e2e-'));
  clock = 1000;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/**
 * 全链路装配：真实 SessionManager/RunManager + LocalRuntimeAdapter。
 * 默认启用持久化日志（issue #75）——目录写入 e2e 临时目录，跑完即清。
 */
function makeStack(runtime = new LocalRuntimeAdapter({ now: () => clock })) {
  const store = new JsonFileStore(dir);
  const sessions = new SessionManager({
    sessions: new SessionRepository(store),
    messages: new MessageRepository(store),
    runs: new RunRepository(store),
    piSessionDir: join(dir, 'pi-sessions'),
    now: () => clock,
  });
  const runs = new RunManager({
    sessions,
    runs: new RunRepository(store),
    runtime,
    now: () => clock,
    streamLogDir: join(dir, 'stream-events'),
  });
  return { sessions, runs };
}

/** 可控 registry：execute 由用例注入行为（默认立即成功），不触网络。 */
function fakeRegistry(behavior: (input: { name: string; args: Record<string, unknown> }) => Promise<unknown>) {
  return {
    getTools: (): ToolDefinition[] => [],
    execute: async (input: { name: string; args: Record<string, unknown> }) => {
      const details = await behavior(input);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(details) }],
        details,
        provenance: { providerId: 'fake', retrievedAt: clock },
      };
    },
  } as never;
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 2000) {
  const started = Date.now();
  while (!(await predicate())) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('waitFor timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const MESSAGE_LEVEL_TYPES = new Set(['message_started', 'text_delta', 'message_completed', 'cancelled']);

/** ADR 0001：每 run sequence 从 1 开始严格 +1，所有事件共同遵守。 */
function expectStrictSequence(events: StreamEvent[]) {
  expect(events.map((e) => e.sequence)).toEqual(events.map((_, i) => i + 1));
}

/** #34 身份契约：message 级事件必带 messageId，run 级不带。 */
function expectIdentityContract(events: StreamEvent[]) {
  for (const event of events) {
    if (MESSAGE_LEVEL_TYPES.has(event.type)) {
      expect(typeof event.messageId).toBe('string');
    } else {
      expect(event.messageId).toBeUndefined();
    }
  }
}

describe('Stream Event replay E2E（真实 runtime 全链路）', () => {
  it('完整 run 后：replay(runId, 0) 补发全量连续事件，atEnd=true，身份契约成立', async () => {
    const { sessions, runs } = makeStack();
    const session = await sessions.createSession('E2E replay');
    const run = await runs.startRun(session.id, '你好，随便聊聊'); // unsupported 意图：无 tool，确定性
    await waitFor(async () => !runs.isRunning());

    const replay = runs.replayStream(run.id, 0);
    expect(replay.recoverable).toBe(true);
    expect(replay.atEnd).toBe(true);
    expectStrictSequence(replay.events);
    expectIdentityContract(replay.events);
    expect(replay.events.map((e) => e.type)).toEqual([
      'run_started',
      'message_started',
      'text_delta',
      'message_completed',
      'run_completed',
    ]);
    // text_delta 载荷为增量文本，拼接后与落库答案一致。
    const text = replay.events
      .filter((e): e is Extract<StreamEvent, { type: 'text_delta' }> => e.type === 'text_delta')
      .map((e) => e.payload.text)
      .join('');
    const messages = await sessions.listMessages(session.id);
    expect(text).toBe(messages[1]?.content);
  });

  it('断线（无实时订阅者）：事件仍入历史，重连后全量补发', async () => {
    const { sessions, runs } = makeStack();
    const session = await sessions.createSession('offline');
    // 注意：全程不调用 subscribeStream —— 模拟 renderer 掉线期间 run 照常执行。
    const run = await runs.startRun(session.id, '你好，随便聊聊');
    await waitFor(async () => !runs.isRunning());

    const replay = runs.replayStream(run.id, 0);
    expect(replay.recoverable).toBe(true);
    expectStrictSequence(replay.events);
    expect(replay.events.length).toBeGreaterThanOrEqual(5);
  });

  it('跨进程重启：磁盘日志恢复历史，replay 对重启前的 run 仍可用', async () => {
    const first = makeStack();
    const session = await first.sessions.createSession('restart me');
    const run = await first.runs.startRun(session.id, '你好，随便聊聊');
    await waitFor(async () => !first.runs.isRunning());

    // 模拟进程重启：同一 storageDir 新建一整套 kernel（不保留原 RunManager 内存状态）。
    const second = makeStack();
    const replay = second.runs.replayStream(run.id, 0);
    expect(replay.recoverable).toBe(true);
    expectStrictSequence(replay.events);
    expect(replay.atEnd).toBe(true);
    expect(replay.events.map((e) => e.type)).toEqual([
      'run_started',
      'message_started',
      'text_delta',
      'message_completed',
      'run_completed',
    ]);
    // 重启后按 lastSequence 补发剩余段同样成立。
    const tail = second.runs.replayStream(run.id, 2);
    expect(tail.recoverable).toBe(true);
    expect(tail.events[0]?.sequence).toBe(3);
    expect(tail.atEnd).toBe(true);
  });

  it('中途断线：按已收 lastSequence 补发剩余段，拼接与全量一致', async () => {
    const { sessions, runs } = makeStack();
    const session = await sessions.createSession('mid-run disconnect');
    const received: StreamEvent[] = [];
    // 模拟 renderer 订阅后中途掉线：只保留前 2 条。
    const unsubscribe = runs.subscribeStream((_sessionId, event) => {
      if (received.length < 2) received.push(event);
    });

    const run = await runs.startRun(session.id, '你好，随便聊聊');
    await waitFor(async () => !runs.isRunning());
    unsubscribe();

    expect(received.length).toBe(2);
    const lastSequence = received[received.length - 1].sequence;

    // “重连”：先全量核对，再按 lastSequence 补发并拼接。
    const full = runs.replayStream(run.id, 0);
    const tail = runs.replayStream(run.id, lastSequence);
    expect(tail.recoverable).toBe(true);
    expect(tail.events[0]?.sequence).toBe(lastSequence + 1);
    expect([...received, ...tail.events]).toEqual(full.events);
    expect(tail.atEnd).toBe(true);
  });

  it('取消路径：显式 cancelled 事件入历史并可补发，atEnd=true', async () => {
    // 慢 registry：execute 挂起直到用例放行，保证 cancel 落在 run 执行窗口内。
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runtime = new LocalRuntimeAdapter({
      now: () => clock,
      registry: fakeRegistry(async () => {
        await gate;
        return { lastPrice: 220 };
      }),
    });
    const { sessions, runs } = makeStack(runtime);
    const session = await sessions.createSession('cancel');

    const run = await runs.startRun(session.id, 'AAPL.US 行情'); // 路由到 get_quote → 慢 registry
    await waitFor(async () => runs.isRunning());
    await runs.cancelRun(session.id, run.id);
    release?.();
    await waitFor(async () => !runs.isRunning());

    const persisted = await sessions.getRun(session.id, run.id);
    expect(persisted?.status).toBe('cancelled');

    const replay = runs.replayStream(run.id, 0);
    expect(replay.recoverable).toBe(true);
    expect(replay.atEnd).toBe(true);
    expectStrictSequence(replay.events);
    expectIdentityContract(replay.events);
    const terminal = replay.events[replay.events.length - 1];
    expect(terminal?.type).toBe('cancelled');
    if (terminal?.type === 'cancelled') {
      expect(terminal.payload.reason).toBe('user');
    }
  });

  it('带工具的 run：tool 事件入历史并可全量补发', async () => {
    const runtime = new LocalRuntimeAdapter({
      now: () => clock,
      registry: fakeRegistry(async () => ({ lastPrice: 220, changePercent: 1.5 })),
    });
    const { sessions, runs } = makeStack(runtime);
    const session = await sessions.createSession('with tools');

    const run = await runs.startRun(session.id, 'AAPL.US 行情');
    await waitFor(async () => !runs.isRunning());

    const replay = runs.replayStream(run.id, 0);
    expect(replay.recoverable).toBe(true);
    expectStrictSequence(replay.events);
    expectIdentityContract(replay.events);
    expect(replay.events.map((e) => e.type)).toEqual([
      'run_started',
      'tool_started',
      'tool_result',
      'message_started',
      'text_delta',
      'message_completed',
      'run_completed',
    ]);
    const toolResult = replay.events.find(
      (e): e is Extract<StreamEvent, { type: 'tool_result' }> => e.type === 'tool_result'
    );
    expect(toolResult?.payload.name).toBe('get_quote');
  });

  it('未知 run 与伪造游标：明确不可恢复', async () => {
    const { sessions, runs } = makeStack();
    const session = await sessions.createSession('unknown');
    const run = await runs.startRun(session.id, '你好，随便聊聊');
    await waitFor(async () => !runs.isRunning());

    expect(runs.replayStream('never-seen', 0)).toEqual({ recoverable: false, events: [], atEnd: true });
    // 断在 5，但该 run 实际只有 5 条事件（1..5）——lastSequence 超出末尾不算缺失。
    const beyond = runs.replayStream(run.id, 99);
    expect(beyond.recoverable).toBe(false);
    expect(beyond.events).toEqual([]);
  });
});
