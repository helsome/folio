// Core type definitions for Finagent

export interface Quote {
  symbol: string;
  lastPrice: number;
  change: number;
  changePercent: number;
  volume: number;
  timestamp: number;
  high: number;
  low: number;
  open: number;
  prevClose: number;
}

export interface Position {
  symbol: string;
  name: string;
  quantity: number;
  avgCost: number;
  lastPrice: number;
  marketValue: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
}

export interface Portfolio {
  totalValue: number;
  cash: number;
  positions: Position[];
}

export interface Kline {
  symbol: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IntradayData {
  symbol: string;
  timestamp: number;
  price: number;
  volume: number;
}

// (Legacy flat Alert removed in V3 — the discriminated AlertRule union in
// alert-rules.ts replaces it.)

export interface NewsItem {
  id: string;
  title: string;
  summary: string;
  url: string;
  timestamp: number;
  symbols: string[];
}

/** Static reference info for a security. */
export interface StaticInfo {
  symbol: string;
  name: string;
  exchange?: string;
  currency?: string;
  lotSize?: number;
  totalShares?: number;
  circulatingShares?: number;
  eps?: number;
  epsTtm?: number;
  bps?: number;
  dividend?: number;
}

/** Calculated financial indexes (PE, PB, dividend yield, market value…). */
export interface CalcIndex {
  symbol: string;
  pe?: number;
  pb?: number;
  dpsRate?: number;
  totalMarketValue?: number;
  turnoverRate?: number;
  ytdChangeRate?: number;
  volumeRatio?: number;
  amplitude?: number;
}

/** Per-exchange market session status. */
export interface MarketStatus {
  market: string;
  status: string;
}

export interface AnalystRating {
  symbol: string;
  rating: 'buy' | 'neutral' | 'sell';
  targetPrice: number;
  analyst: string;
  firm: string;
  timestamp: number;
}

export type SessionStatus = 'idle' | 'running' | 'error';

export interface Session {
  id: string;
  title: string;
  status: SessionStatus;
  createdAt: number;
  updatedAt: number;
  /** Runtime-context identity (e.g. Pi session id) so the runtime conversation can be recovered after restart. */
  runtimeSessionId?: string;
  /** Runtime session file path (e.g. Pi JSONL session file). */
  runtimeSessionPath?: string;
  /** Recently referenced symbols, restored into the runtime after restart. */
  recentSymbols?: string[];
}

/** Session metadata for list views; messages are stored separately. */
export interface SessionMeta extends Session {
  messageCount: number;
  lastMessageAt?: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  toolName?: string;
  toolCalls?: ToolCallRecord[];
  trace?: AgentTraceEvent[];
}

export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/** One agent execution inside a session. */
export interface Run {
  id: string;
  sessionId: string;
  status: RunStatus;
  input: string;
  startedAt: number;
  completedAt?: number;
  answer?: string;
  error?: ApiError;
}

/** Live tool call state, streamed through agent events. */
export interface ToolCall {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  startedAt: number;
  completedAt?: number;
  status: 'running' | 'success' | 'error';
  result?: unknown;
  error?: ApiError;
}

export type AgentEventType =
  | 'run_started'
  | 'message_started'
  | 'message_delta'
  | 'message_completed'
  | 'tool_started'
  | 'tool_completed'
  | 'run_completed'
  | 'run_failed';

/** Unified agent event protocol shared between runtime, IPC, and UI. */
interface AgentEventBase {
  id: string;
  sessionId: string;
  runId: string;
  timestamp: number;
  sequence: number;
}

export type AgentEvent =
  | AgentEventBase & { type: 'run_started'; payload: RunStartedPayload }
  | AgentEventBase & { type: 'message_started' }
  | AgentEventBase & { type: 'message_delta'; payload: MessageDeltaPayload }
  | AgentEventBase & { type: 'message_completed'; payload: MessageCompletedPayload }
  | AgentEventBase & { type: 'tool_started'; payload: ToolStartedPayload }
  | AgentEventBase & { type: 'tool_completed'; payload: ToolCompletedPayload }
  | AgentEventBase & { type: 'run_completed'; payload: RunCompletedPayload }
  | AgentEventBase & { type: 'run_failed'; payload: RunFailedPayload };

export interface RunStartedPayload {
  run: Run;
  userMessage: Message;
}

/**
 * Structured tool-result metadata. Tools may attach it so both the UI and the
 * agent can reason about where data came from and how fresh it is.
 */
export interface ToolResultProvenance {
  provider: string;
  fetchedAt: number;
  marketTime?: number;
  stale?: boolean;
}

/** Structured tool result: raw data plus optional provenance. */
export interface StructuredToolResult<T> {
  data: T;
  provenance?: ToolResultProvenance;
}

export interface MessageDeltaPayload {
  delta: string;
  answer: string;
}

export interface ToolStartedPayload {
  toolCall: ToolCall;
}

export interface ToolCompletedPayload {
  toolCall: ToolCall;
}

export interface MessageCompletedPayload {
  answer: string;
}

export interface RunCompletedPayload {
  answer: string;
  toolCalls: ToolCall[];
}

export interface RunFailedPayload {
  error: ApiError;
}

export type AgentEventPayload =
  | RunStartedPayload
  | MessageDeltaPayload
  | ToolStartedPayload
  | ToolCompletedPayload
  | MessageCompletedPayload
  | RunCompletedPayload
  | RunFailedPayload;

/** Runtime-side session handle that maps a Folio session to a runtime conversation. */
export interface RuntimeSession {
  sessionId: string;
  runtimeSessionId?: string;
  sessionPath?: string;
  status: 'active' | 'inactive' | 'error';
}

export interface ToolDefinition {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ApiError {
  code: string;
  message: string;
  action?: string;
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

export interface LongBridgeStatus {
  installed: boolean;
  authed?: boolean;
  authenticated: boolean;
  available: boolean;
  status?: string;
  code?: string;
  error?: {
    code: string;
    message: string;
  };
  message: string;
  action?: string;
}

export interface AgentResponse {
  answer: string;
  content: string;
  toolName?: string;
  tool?: string;
  result?: unknown;
  details?: unknown;
  toolCalls?: ToolCallRecord[];
  sessionSnapshot: AgentSessionSnapshot;
  session?: AgentSessionSnapshot;
  trace?: AgentTraceEvent[];
}

export interface AgentRequest {
  sessionId: string;
  content: string;
  context?: Record<string, unknown>;
  createdAt?: number;
}

export interface AgentSessionSnapshot {
  id: string;
  recentSymbols: string[];
  lastIntent?: string;
  lastError?: ApiError;
  toolCalls: ToolCallRecord[];
}

export interface ToolCallRecord {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  startedAt: number;
  completedAt?: number;
  status: 'success' | 'error';
  error?: ApiError;
  result?: unknown;
  trace?: AgentTraceEvent[];
}

export interface AgentBackend {
  getTools: () => Promise<ApiResult<ToolDefinition[]>>;
  send: (request: AgentRequest) => Promise<ApiResult<AgentResponse>>;
  dispose?: () => Promise<void>;
}

export type WorkspaceView = 'overview' | 'chart' | 'financials' | 'news' | 'portfolio';

/**
 * Current financial-object context of the workspace.
 *
 * Deliberately separate from Agent Session state: a Session is the
 * conversation scope, a WorkspaceContext is the security / view the user is
 * currently looking at. It is ephemeral (per run) and never persisted.
 */
export interface WorkspaceContext {
  activeSymbol?: string;
  activeView?: WorkspaceView;
  selectedPosition?: string;
  /** Set when the Compare workspace is focused; feeds the compare agent context. */
  comparisonSymbols?: string[];
}

export interface AgentRunInput {
  sessionId: string;
  runId: string;
  content: string;
  workspaceContext?: WorkspaceContext;
}

/** A model as reported by the Pi model registry. */
export interface LlmModel {
  provider: string;
  id: string;
  name?: string;
  api?: string;
  baseUrl?: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  /** Supported thinking levels for this model: level → runtime mapping (null = unsupported). */
  thinkingLevelMap?: Record<string, string | null>;
}

/** LLM runtime state reported to the renderer. */
export interface LlmRuntimeState {
  /** Agent runtime provider (local | pi-runtime). */
  runtimeProvider: string;
  model?: LlmModel;
  thinkingLevel: string;
  /** Thinking levels supported by the active model (empty in local mode). */
  availableThinkingLevels: string[];
  isStreaming: boolean;
  sessionId?: string;
  messageCount?: number;
}

export type ProviderStatusKind =
  | 'connected'
  | 'missing_credential'
  | 'unavailable'
  | 'runtime_error';

export interface ProviderStatus {
  provider: string;
  displayName?: string;
  status: ProviderStatusKind;
  modelCount?: number;
  message?: string;
  custom?: boolean;
}

/** One custom (OpenAI-compatible) provider model definition. */
export interface CustomProviderModel {
  id: string;
  name: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
}

/**
 * Custom OpenAI-compatible provider configuration. `apiKey` only ever lives
 * in the main process; the renderer sends it once and never reads it back.
 */
export interface CustomProviderConfig {
  name: string;
  displayName: string;
  baseUrl: string;
  api?: string;
  apiKey?: string;
  models: CustomProviderModel[];
}

/** Renderer-safe credential metadata (no secrets). */
export interface CredentialInfo {
  provider: string;
  configured: boolean;
  updatedAt?: number;
  custom?: boolean;
}

export interface LlmTestResult {
  ok: boolean;
  message: string;
  provider: string;
  modelId: string;
  latencyMs?: number;
}

/**
 * Long-lived agent runtime abstraction.
 *
 * A runtime owns runtime conversations (one per Folio session), executes runs
 * as streaming AgentEvent sequences, and supports cancellation.
 */
export interface AgentRuntime {
  getTools: () => Promise<ApiResult<ToolDefinition[]>>;
  ensureSession: (session: {
    id: string;
    title?: string;
    sessionPath?: string;
    recentSymbols?: string[];
  }) => Promise<RuntimeSession>;
  run: (input: AgentRunInput) => AsyncIterable<AgentEvent>;
  cancel: (input: { sessionId: string; runId: string }) => Promise<void>;
  disposeSession?: (sessionId: string) => Promise<void>;
  dispose: () => Promise<void>;
}

export type AgentBackendProvider = 'local' | 'pi-runtime';

export interface AgentTraceEvent {
  id: string;
  type: string;
  timestamp: number;
  message?: string;
  data?: unknown;
}

export interface KlineRequest {
  symbol: string;
  period?: '1m' | '5m' | '15m' | '1h' | '1d' | '1w';
  limit?: number;
}

export interface Skill {
  id: string;
  name: string;
  type: 'tool' | 'prompt' | 'hybrid';
  trigger: {
    keywords: string[];
  };
  prompt?: {
    system: string;
    user?: string;
  };
  tool?: ToolDefinition;
  metadata: {
    enabled: boolean;
    editable: boolean;
    createdAt: number;
    updatedAt: number;
  };
}

// ── Folio V3 domains ───────────────────────────────────────────────────────
export * from './capability.ts';
export * from './research.ts';
export * from './thesis.ts';
export * from './alert-rules.ts';
export * from './readiness.ts';
export * from './compare.ts';
export * from './portfolio-risk.ts';
export * from './provider.ts';
export * from './account.ts';
export * from './market-data.ts';
