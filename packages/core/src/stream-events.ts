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
 * 统一事件信封。
 * - 幂等键：runId + messageId + sequence。
 * - sequence 为 run 内单调递增；reconnect 以它为游标（lastSequence 补发）。
 * - timestamp 仅用于展示/排序，不作为身份。
 */
export interface StreamEventEnvelope<T extends StreamEventType = StreamEventType> {
  protocolVersion: typeof STREAM_EVENT_PROTOCOL_VERSION;
  runId: string;
  /** v1 与 runId 相同；预留“一条 message 跨多次 run”时拆分。 */
  messageId: string;
  sequence: number;
  type: T;
  timestamp: string;
  payload: StreamEventTypeToPayload[T];
}

export type StreamEvent<T extends StreamEventType = StreamEventType> = StreamEventEnvelope<T>;

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