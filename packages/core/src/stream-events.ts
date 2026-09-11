// Stream Event Protocol v1
//
// 结构化流式事件协议的类型定义（issue #27）。
// 这是协议层的"纯类型 + 枚举"交付，无任何运行时行为变更。
// 设计文档：docs/adr/0001-stream-event-protocol.md
//
// 与现有 AgentEvent（同文件 index.ts）的关系：
// - AgentEvent 是内部 8 事件隐式协议；本模块是其协议化升级版（12 事件 + 版本 + 单调 seq）。
// - 迁移期间两者并存，AgentEvent 逐步被取代（见 ADR "Migration" 一节）。

export const STREAM_EVENT_PROTOCOL_VERSION = 1 as const;

export type StreamStatusPhase = 'thinking' | 'searching' | 'working';
export type StreamCancelReason = 'user' | 'budget' | 'runtime';
export type StreamStopReason = 'completed' | 'cancelled' | 'error' | 'budget';

/** 协议事件类型全集（12 种）。 */
export type StreamEventType =
  | 'run_started'
  | 'message_started'
  | 'text_delta'
  | 'tool_started'
  | 'tool_progress'
  | 'tool_result'
  | 'citation_added'
  | 'status'
  | 'error'
  | 'cancelled'
  | 'message_completed'
  | 'run_completed';

/** 类型 -> payload 映射。envelope.type 作为唯一判别字段，payload 不再重复 type。 */
export interface StreamEventTypeToPayload {
  run_started: { input: string; startedAt: string };
  message_started: Record<string, never>;
  text_delta: { text: string };
  tool_started: { callId: string; name: string; input?: unknown };
  tool_progress: { callId: string; progress?: unknown };
  tool_result: { callId: string; name: string; result: unknown };
  citation_added: { citationId: string; sourceId: string };
  status: { phase: StreamStatusPhase; detail?: string };
  error: { code: string; message: string; retryable: boolean };
  cancelled: { reason: StreamCancelReason; partial: { text: string } };
  message_completed: Record<string, never>;
  run_completed: { stopReason: StreamStopReason };
}

export type StreamEventPayload = StreamEventTypeToPayload[StreamEventType];

/**
 * 统一事件信封（参数化版本，供内部组合用）。
 * - 幂等键：runId + sequence（messageId 不作为幂等身份的一部分）。
 * - sequence 为 run 内单调递增；reconnect 以它为游标（lastSequence 补发）。
 * - timestamp 仅用于展示/排序，不作为身份。
 *
 * 身份语义（对齐 issue #34 / 维护者 #43 review）：
 * - runId：一次 generation 的唯一身份，所有事件必填。
 * - messageId：仅 message 级事件（message_started / text_delta /
 *   message_completed / cancelled 的部分文本归属）携带到真实、稳定的
 *   message id；run 级事件（run_started / run_completed / tool_* /
 *   citation_added / status / error）可省略。message 与 run 是两个身份，
 *   允许一条 message 跨多次 run（edit/regenerate/fork，见 #34）。
 */
export interface StreamEventEnvelope<T extends StreamEventType = StreamEventType> {
  protocolVersion: typeof STREAM_EVENT_PROTOCOL_VERSION;
  runId: string;
  messageId?: string;
  sequence: number;
  type: T;
  timestamp: string;
  payload: StreamEventTypeToPayload[T];
}

/**
 * 可判别事件联合：type 与 payload 强关联，switch/if 收窄后可直接访问
 * 对应 payload 字段（非简单的 envelope<T = StreamEventType> 索引联合）。
 */
export type StreamEvent<T extends StreamEventType = StreamEventType> = {
  [P in T]: StreamEventEnvelope<P>;
}[T];

/** 供完整性检查/测试用的枚举列表，必须与 StreamEventType 一一对应。 */
export const STREAM_EVENT_TYPES = [
  'run_started',
  'message_started',
  'text_delta',
  'tool_started',
  'tool_progress',
  'tool_result',
  'citation_added',
  'status',
  'error',
  'cancelled',
  'message_completed',
  'run_completed',
] as const satisfies readonly StreamEventType[];