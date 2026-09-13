// AgentEvent → Stream Event Protocol v1 转换器（仅运行期映射，无副作用）。
// 供 RunManager 在现有 AgentEvent 广播旁并行产出协议事件（issue #27，
// docs/adr/0001-stream-event-protocol.md，Migration step 2）。

import type { AgentEvent, StreamCancelReason, StreamEvent } from '@finagent/core';
import { STREAM_EVENT_PROTOCOL_VERSION } from '@finagent/core';

/**
 * run_failed 的 error.code → 取消原因（ADR 0001 §Cross-cutting contracts）。
 * RUN_CANCELLED 为用户主动取消；BUDGET_EXHAUSTED 为预算护栏终止；
 * RETRY_STORM / LOOP_DETECTED 为 runaway 检测终止。三者都是"被主动终止"，
 * 归一为 cancelled；其余失败才归一为 error。
 */
const CANCEL_REASON_BY_CODE: Record<string, StreamCancelReason> = {
  RUN_CANCELLED: 'user',
  BUDGET_EXHAUSTED: 'budget',
  RETRY_STORM: 'runtime',
  LOOP_DETECTED: 'runtime',
};

/**
 * 把单个 AgentEvent 映射为一条或多条 StreamEvent。
 * - 时间戳：AgentEvent 用 epoch 毫秒 number，协议层用 ISO 8601 UTC string。
 * - 身份（对齐 issue #34）：runId 恒有；messageId 仅注入到 message 级事件
 *   （message_started / text_delta / message_completed / cancelled），
 *   取 run 对应的真实 assistant message id；run 级事件不携带 messageId。
 * - run_failed 按 error.code 归一：主动取消 → cancelled（带 partial 文本），
 *   其余失败归一为 error。
 */
export function toStreamEvents(
  event: AgentEvent,
  opts?: {
    messageId?: string;
    /** 取消时已生成的 assistant 文本（cancelled.partial.text 的数据源）。 */
    partialText?: string;
  }
): StreamEvent[] {
  const base = {
    protocolVersion: STREAM_EVENT_PROTOCOL_VERSION,
    runId: event.runId,
    sequence: event.sequence,
    timestamp: new Date(event.timestamp).toISOString(),
  };
  const messageish = opts?.messageId ? { messageId: opts.messageId } : {};

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
      return [{ ...base, ...messageish, type: 'message_started', payload: {} }];
    case 'message_delta':
      return [{ ...base, ...messageish, type: 'text_delta', payload: { text: event.payload.delta } }];
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
      return [{ ...base, ...messageish, type: 'message_completed', payload: {} }];
    case 'run_completed':
      return [{ ...base, type: 'run_completed', payload: { stopReason: 'completed' } }];
    case 'run_failed': {
      const { error } = event.payload;
      const reason = CANCEL_REASON_BY_CODE[error.code];
      if (reason) {
        return [
          {
            ...base,
            ...messageish,
            type: 'cancelled',
            payload: { reason, partial: { text: opts?.partialText ?? '' } },
          },
        ];
      }
      return [
        { ...base, type: 'error', payload: { code: error.code, message: error.message, retryable: false } },
      ];
    }
  }
}
