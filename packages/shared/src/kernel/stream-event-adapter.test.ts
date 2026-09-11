// Stream Event Protocol v1 — AgentEvent→StreamEvent 映射完整性测试。

import { describe, expect, it } from 'bun:test';
import type { AgentEvent } from '@finagent/core';
import { toStreamEvents } from './stream-event-adapter.ts';

function makeEvent(partial: Partial<AgentEvent> & { type: AgentEvent['type']; payload: AgentEvent['payload'] }): AgentEvent {
  return {
    id: 'id-1',
    sessionId: 'sess-1',
    runId: 'run-1',
    timestamp: 1726000000000,
    sequence: 5,
    ...partial,
  } as AgentEvent;
}

describe('toStreamEvents', () => {
  it('映射 run_started（含 input 与 ISO 时间戳）', () => {
    const [ev] = toStreamEvents(
      makeEvent({
        type: 'run_started',
        payload: {
          run: { id: 'run-1', sessionId: 'sess-1', status: 'running', input: 'AAPL.US', startedAt: 1726000000000 },
          userMessage: { id: 'm1', role: 'user', content: 'AAPL.US', timestamp: 1726000000000 },
        },
      })
    );
    expect(ev.type).toBe('run_started');
    if (ev.type === 'run_started') {
      expect(ev.protocolVersion).toBe(1);
      expect(ev.messageId).toBe('run-1');
      expect(ev.sequence).toBe(5);
      expect(ev.payload.input).toBe('AAPL.US');
      expect(ev.payload.startedAt).toBe('2024-09-10T20:26:40.000Z');
      expect(ev.timestamp).toBe('2024-09-10T20:26:40.000Z');
    }
  });

  it('映射 message_delta → text_delta（增量字段无损）', () => {
    const [ev] = toStreamEvents(
      makeEvent({ type: 'message_delta', payload: { delta: 'Apple ', answer: 'Apple Inc.' } })
    );
    expect(ev.type).toBe('text_delta');
    if (ev.type === 'text_delta') {
      expect(ev.payload.text).toBe('Apple ');
    }
  });

  it('映射 tool 事件为 tool_started / tool_result', () => {
    const toolCall = {
      id: 'tc-1',
      toolName: 'get_quote',
      args: { symbol: 'AAPL.US' },
      startedAt: 1,
      status: 'success' as const,
      result: { lastPrice: 220 },
    };
    const [started] = toStreamEvents(makeEvent({ type: 'tool_started', payload: { toolCall } }));
    const [result] = toStreamEvents(makeEvent({ type: 'tool_completed', payload: { toolCall } }));
    if (started.type === 'tool_started') {
      expect(started.payload.callId).toBe('tc-1');
      expect(started.payload.name).toBe('get_quote');
    }
    if (result.type === 'tool_result') {
      expect(result.payload.result).toEqual({ lastPrice: 220 });
    }
  });

  it('映射 run_completed → stopReason=completed / message_completed', () => {
    const [completed] = toStreamEvents(
      makeEvent({ type: 'message_completed', payload: { answer: 'done' } })
    );
    const [done] = toStreamEvents(
      makeEvent({ type: 'run_completed', payload: { answer: 'done', toolCalls: [] } })
    );
    expect(completed.type).toBe('message_completed');
    if (done.type === 'run_completed') {
      expect(done.payload.stopReason).toBe('completed');
    }
  });

  it('任务失败映射为 error（保留 code/message）', () => {
    const [ev] = toStreamEvents(
      makeEvent({
        type: 'run_failed',
        payload: { error: { code: 'TOOL_ERROR', message: 'provider timeout' } },
      })
    );
    expect(ev.type).toBe('error');
    if (ev.type === 'error') {
      expect(ev.payload.code).toBe('TOOL_ERROR');
      expect(ev.payload.message).toBe('provider timeout');
      expect(ev.payload.retryable).toBe(false);
    }
  });

  it('用户取消映射为 cancelled（reason=user）', () => {
    const [ev] = toStreamEvents(
      makeEvent({
        type: 'run_failed',
        payload: { error: { code: 'RUN_CANCELLED', message: 'Run cancelled by user.' } },
      })
    );
    expect(ev.type).toBe('cancelled');
    if (ev.type === 'cancelled') {
      expect(ev.payload.reason).toBe('user');
      expect(ev.payload.partial).toEqual({ text: '' });
    }
  });
});