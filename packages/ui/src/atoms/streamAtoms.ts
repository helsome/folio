// Stream Event Protocol v1 — renderer 侧事件缓冲与幂等（issue #27，PR-D）。
//
// 目标：在不改变现有渲染路径的前提下，把 onStreamEvent 的协议事件按
// run 有序缓存 + 幂等去重，供后续渲染切换使用（text_delta 增量渲染、
// cancelled 显式状态等）。纯函数 reducer，可单测。

import { atom } from 'jotai';
import type { StreamEvent } from '@finagent/core';

export interface StreamLogInput {
  sessionId: string;
  event: StreamEvent;
}

export interface StreamLogState {
  /** runId → 该 run 内已收到的事件（按 sequence 有序）。 */
  byRun: ReadonlyMap<string, ReadonlyArray<StreamEvent>>;
  /** 因重复 sequence 被幂等丢弃的事件数。 */
  drops: number;
  /** sequence 出现 gap 或乱序的次数（协议健康指标）。 */
  anomalies: number;
  /** 最近一条事件。 */
  last?: StreamLogInput;
}

const EMPTY_STATE: StreamLogState = { byRun: new Map(), drops: 0, anomalies: 0 };

export function reduceStreamLog(state: StreamLogState, input: StreamLogInput): StreamLogState {
  const { event } = input;
  const prev = state.byRun.get(event.runId) ?? [];

  const lastSeq = prev.length > 0 ? prev[prev.length - 1].sequence : 0;
  // 幂等：prev 按 sequence 有序，重复只可能落在已见过的区间内，因此仅在
  // sequence <= lastSeq 时做一次扫描，避免每条事件都全量遍历（长 run 下的 O(n²)）。
  if (event.sequence <= lastSeq && prev.some((e) => e.sequence === event.sequence)) {
    return { ...state, drops: state.drops + 1, last: input };
  }

  const isAnomaly = event.sequence <= lastSeq || event.sequence !== lastSeq + 1;
  const next = isAnomaly
    ? [...prev, event].sort((a, b) => a.sequence - b.sequence)
    : [...prev, event];

  return {
    byRun: new Map(state.byRun).set(event.runId, next),
    drops: state.drops,
    anomalies: state.anomalies + (isAnomaly ? 1 : 0),
    last: input,
  };
}

/** 运行中的协议事件日志（调试与渐进渲染的数据源）。 */
export const streamLogAtom = atom<StreamLogState>(EMPTY_STATE);

/** 由 KernelBridge 订阅 onStreamEvent 后喂入。 */
export const applyStreamEventAtom = atom(null, (_get, set, input: StreamLogInput) => {
  set(streamLogAtom, reduceStreamLog(_get(streamLogAtom), input));
});