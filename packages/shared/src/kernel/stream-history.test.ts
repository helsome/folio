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

  it('超过 MAX_RUNS 后淘汰最久未活跃的 run，最近追加过事件的 run 仍可 replay', () => {
    const h = new StreamEventHistory();
    for (let i = 0; i < 32; i += 1) fill(h, `run-${i}`, 1, 1);
    // run-0 重新活跃：必须刷新到 LRU 队尾，而不是被下一个新 run 按
    // 首次出现顺序淘汰（issue #146 的复现路径）。
    h.append(make('run-0', 2, 'text_delta'));
    fill(h, 'run-32', 1, 1);
    const result = h.replay('run-0', 1);
    expect(result.recoverable).toBe(true);
    expect(result.events.map((e) => e.sequence)).toEqual([2]);
    // 最久未活跃的 run-1 被淘汰。
    expect(h.replay('run-1', 0).recoverable).toBe(false);
  });

  it('被幂等拒绝的 append 不刷新 LRU 顺序', () => {
    const h = new StreamEventHistory();
    for (let i = 0; i < 32; i += 1) fill(h, `run-${i}`, 1, 1);
    // 重复/倒退的 seq 被拒绝，不算"活跃"，不改变淘汰顺序。
    expect(h.append(make('run-0', 0, 'text_delta'))).toBe(false);
    fill(h, 'run-32', 1, 1);
    expect(h.replay('run-0', 0).recoverable).toBe(false);
    expect(h.replay('run-1', 0).recoverable).toBe(true);
  });
});