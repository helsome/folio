// AgentEvent → Stream Event Protocol v1 转换器（仅运行期映射，无副作用）。
// 供 RunManager 在现有 AgentEvent 广播旁并行产出协议事件（issue #27，
// docs/adr/0001-stream-event-protocol.md，Migration step 2）。

import type { AgentEvent, StreamEvent } from '@finagent/core';
import { STREAM_EVENT_PROTOCOL_VERSION } from '@finagent/core';

/**
 * 把单个 AgentEvent 映射为一条或多条 StreamEvent。
 * - 时间戳：AgentEvent 用 epoch 毫秒 number，协议层用 ISO 8601 UTC string。
 * - messageId 与 runId 合并（v1，见 ADR）。
 * - run_failed(code=RUN_CANCELLED) 归一为 cancelled 事件；其余失败归一为 error。
 */
export function toStreamEvents(event: AgentEvent): StreamEvent[] {
  const base = {
    protocolVersion: STREAM_EVENT_PROTOCOL_VERSION,
    runId: event.runId,
    messageId: event.runId,
    sequence: event.sequence,
    timestamp: new Date(event.timestamp).toISOString(),
  };

  switch (event.type) {
    case 'run_started':
      return [
        {
          ...base,
          type: 'run_started',
          payload: {
            input: event.payload.run.input,
            startedAt: new Date(event.payload.run.startedAt).toISOString(),
          },
        },
      ];
    case 'message_started':
      return [{ ...base, type: 'message_started', payload: {} }];
    case 'message_delta':
      return [{ ...base, type: 'text_delta', payload: { text: event.payload.delta } }];
    case 'tool_started':
      return [
        {
          ...base,
          type: 'tool_started',
          payload: {
            callId: event.payload.toolCall.id,
            name: event.payload.toolCall.toolName,
            input: event.payload.toolCall.args,
          },
        },
      ];
    case 'tool_completed':
      return [
        {
          ...base,
          type: 'tool_result',
          payload: {
            callId: event.payload.toolCall.id,
            name: event.payload.toolCall.toolName,
            result: event.payload.toolCall.result,
          },
        },
      ];
    case 'message_completed':
      return [{ ...base, type: 'message_completed', payload: {} }];
    case 'run_completed':
      return [{ ...base, type: 'run_completed', payload: { stopReason: 'completed' } }];
    case 'run_failed': {
      const { error } = event.payload;
      if (error.code === 'RUN_CANCELLED') {
        return [{ ...base, type: 'cancelled', payload: { reason: 'user', partial: { text: '' } } }];
      }
      return [
        { ...base, type: 'error', payload: { code: error.code, message: error.message, retryable: false } },
      ];
    }
  }
}