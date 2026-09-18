// Stream Event Protocol v1 — 类型层完整性测试
// 纯类型交付的自检：事件类型数量/无重复、payload 判别映射、envelope 构造约束。

import { describe, expect, it } from 'bun:test';
import {
  STREAM_EVENT_PROTOCOL_VERSION,
  STREAM_EVENT_TYPES,
  type StreamEvent,
  type StreamEventEnvelope,
  type StreamEventType,
  type StreamEventTypeToPayload,
} from './stream-events.ts';

describe('Stream Event Protocol v1', () => {
  it('枚举 12 种协议事件类型且无重复', () => {
    expect(STREAM_EVENT_TYPES).toHaveLength(12);
    expect(new Set(STREAM_EVENT_TYPES).size).toBe(12);
  });

  it('每个事件类型都有对应的 typed payload（编译期覆盖）', () => {
    // 编译期强制约束：所有 StreamEventType 必须在映射表中存在。
    type Coverage = { [K in StreamEventType]: StreamEventTypeToPayload[K] };
    const coverage: Coverage = {} as Coverage;
    expect(coverage).toBeDefined();
  });

  it('protocol version 恒为 1', () => {
    expect(STREAM_EVENT_PROTOCOL_VERSION).toBe(1);
  });

  it('envelope 按 type 判别 payload（编译期约束）', () => {
    // 通过类型构造示例事件流；completion 事件可用新事件类型
    const runStarted: StreamEvent = {
      protocolVersion: 1,
      runId: 'run-1',
      messageId: 'run-1',
      sequence: 1,
      type: 'run_started',
      timestamp: '2026-09-11T00:00:00.000Z',
      payload: { input: 'show me AAPL.US', startedAt: '2026-09-11T00:00:00.000Z' },
    };
    const delta: StreamEvent = {
      ...runStarted,
      protocolVersion: STREAM_EVENT_PROTOCOL_VERSION,
      sequence: 2,
      type: 'text_delta',
      payload: { text: 'Apple ' },
    };
    const cancelled: StreamEvent = {
      ...runStarted,
      protocolVersion: STREAM_EVENT_PROTOCOL_VERSION,
      sequence: 9,
      type: 'cancelled',
      payload: { reason: 'user', partial: { text: 'Apple ' } },
    };
    const done: StreamEvent = {
      ...runStarted,
      protocolVersion: STREAM_EVENT_PROTOCOL_VERSION,
      sequence: 10,
      type: 'run_completed',
      payload: { stopReason: 'cancelled' },
    };

    const events: StreamEvent<StreamEventType>[] = [runStarted, delta, cancelled, done];
    expect(events).toHaveLength(4);
    expect(events[2].type).toBe('cancelled');
  });
});