// Stream Event Protocol v1 — 内存 replay 历史单测。

import { describe, expect, it } from 'bun:test';
import type { StreamEvent } from '@finagent/core';
import { StreamEventHistory } from './stream-history.ts';

function make(runId: string, sequence: number, type: StreamEvent['type']): StreamEvent {
  return {
    protocolVersion: 1,
    runId,
    sequence,
    type,
    timestamp: '2026-09-11T00:00:00.000Z',
    payload: {} as never,
  };
}

function fill(history: StreamEventHistory, runId: string, from: number, to: number, type: StreamEvent['type'] = 'text_delta') {
  for (let s = from; s <= to; s += 1) history.append(make(runId, s, type));
}

describe('StreamEventHistory', () => {
  it('从 0 开始补发整段连续事件', () => {
    const h = new StreamEventHistory();
    fill(h, 'run-1', 1, 3);
    h.append(make('run-1', 4, 'run_completed'));
    const result = h.replay('run-1', 0);
    expect(result.recoverable).toBe(true);
    expect(result.events.map((e) => e.sequence)).toEqual([1, 2, 3, 4]);
    expect(result.atEnd).toBe(true);
  });

  it('只补发 lastSequence 之后的连续段', () => {
    const h = new StreamEventHistory();
    fill(h, 'run-1', 1, 5);
    const result = h.replay('run-1', 2);
    expect(result.recoverable).toBe(true);
    expect(result.events.map((e) => e.sequence)).toEqual([3, 4, 5]);
  });

  it('lastSequence 已是末尾 → 空补发', () => {
    const h = new StreamEventHistory();
    fill(h, 'run-1', 1, 2);
    const result = h.replay('run-1', 2);
    expect(result.recoverable).toBe(true);
    expect(result.events).toEqual([]);
  });

  it('未知 run → 明确不可恢复', () => {
    const h = new StreamEventHistory();
    const result = h.replay('never-seen', 0);
    expect(result.recoverable).toBe(false);
    expect(result.events).toEqual([]);
  });

  it('append 幂等：同 run 重复/倒退的 seq 被拒绝，replay 连续性不受破坏', () => {
    const h = new StreamEventHistory();
    fill(h, 'run-1', 1, 2);
    expect(h.append(make('run-1', 2, 'text_delta'))).toBe(false);
    expect(h.append(make('run-1', 1, 'text_delta'))).toBe(false);
    expect(h.append(make('run-1', 3, 'run_completed'))).toBe(true);

    const result = h.replay('run-1', 0);
    expect(result.recoverable).toBe(true);
    expect(result.events.map((e) => e.sequence)).toEqual([1, 2, 3]);
    expect(result.atEnd).toBe(true);
  });

  it('缺失段（客户端断在 5，历史只剩 ≥99）→ 明确不可恢复', () => {
    const h = new StreamEventHistory();
    fill(h, 'run-1', 99, 102);
    const result = h.replay('run-1', 5);
    expect(result.recoverable).toBe(false);
    expect(result.events).toEqual([]);
  });
});