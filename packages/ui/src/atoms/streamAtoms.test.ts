// Stream Event Protocol v1 — renderer 事件缓冲 reducer 单测。

import { describe, expect, it } from 'bun:test';
import type { StreamEvent } from '@finagent/core';
import { reduceStreamLog, type StreamLogState } from './streamAtoms.ts';

function make(input: { runId?: string; sequence: number; type: StreamEvent['type'] }): StreamEvent {
  return {
    protocolVersion: 1,
    runId: input.runId ?? 'run-1',
    messageId: input.runId ?? 'run-1',
    sequence: input.sequence,
    type: input.type,
    timestamp: '2026-09-11T00:00:00.000Z',
    payload: {} as never,
  };
}

const s0: StreamLogState = { byRun: new Map(), drops: 0, anomalies: 0 };

describe('reduceStreamLog', () => {
  it('按 sequence 顺序累积同 run 事件', () => {
    const s1 = reduceStreamLog(s0, { sessionId: 's1', event: make({ sequence: 1, type: 'run_started' }) });
    const s2 = reduceStreamLog(s1, { sessionId: 's1', event: make({ sequence: 2, type: 'text_delta' }) });
    expect(s2.byRun.get('run-1')?.map((e) => e.type)).toEqual(['run_started', 'text_delta']);
    expect(s2.anomalies).toBe(0);
    expect(s2.drops).toBe(0);
  });

  it('重复 sequence 幂等丢弃（重放不重复投递）', () => {
    const s1 = reduceStreamLog(s0, { sessionId: 's1', event: make({ sequence: 1, type: 'run_started' }) });
    const s2 = reduceStreamLog(s1, { sessionId: 's1', event: make({ sequence: 1, type: 'run_started' }) });
    expect(s2.byRun.get('run-1')).toHaveLength(1);
    expect(s2.drops).toBe(1);
    expect(s2.anomalies).toBe(0);
  });

  it('乱序事件会重排并标记 anomaly', () => {
    const s1 = reduceStreamLog(s0, { sessionId: 's1', event: make({ sequence: 2, type: 'text_delta' }) });
    const s2 = reduceStreamLog(s1, { sessionId: 's1', event: make({ sequence: 1, type: 'run_started' }) });
    expect(s2.byRun.get('run-1')?.map((e) => e.sequence)).toEqual([1, 2]);
    expect(s2.anomalies).toBe(2);
  });

  it('重复 sequence 落在序列中间也幂等丢弃', () => {
    let state = s0;
    for (const sequence of [1, 2, 3]) {
      state = reduceStreamLog(state, { sessionId: 's1', event: make({ sequence, type: 'text_delta' }) });
    }
    const replayed = reduceStreamLog(state, {
      sessionId: 's1',
      event: make({ sequence: 2, type: 'text_delta' }),
    });
    expect(replayed.byRun.get('run-1')?.map((e) => e.sequence)).toEqual([1, 2, 3]);
    expect(replayed.drops).toBe(1);
    expect(replayed.anomalies).toBe(0);
  });

  it('不同 run 互不干扰', () => {
    const s1 = reduceStreamLog(s0, { sessionId: 's1', event: make({ runId: 'run-a', sequence: 1, type: 'run_started' }) });
    const s2 = reduceStreamLog(s1, { sessionId: 's1', event: make({ runId: 'run-b', sequence: 1, type: 'run_started' }) });
    expect(s2.byRun.size).toBe(2);
    expect(s2.byRun.get('run-a')).toHaveLength(1);
    expect(s2.byRun.get('run-b')).toHaveLength(1);
  });

  it('保留最近一条事件', () => {
    const s1 = reduceStreamLog(s0, { sessionId: 's1', event: make({ sequence: 1, type: 'run_started' }) });
    expect(s1.last?.sessionId).toBe('s1');
    expect(s1.last?.event.type).toBe('run_started');
  });
});