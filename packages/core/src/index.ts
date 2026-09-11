// Core type definitions for Finagent

import type { SupportedLocale } from './locale.ts';

export type { SupportedLocale, LocalePreference } from './locale.ts';

export interface Quote {
  symbol: string;
  /** Folio canonical instrument id when the quote was resolved through the catalog. */
  instrumentId?: string;
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
  /** Folio canonical instrument id when news was fetched for a resolved listing. */
  instrumentId?: string;
}

/** Static reference info for a security. */
export interface StaticInfo {
  symbol: string;
  /** Folio canonical instrument id when profile data was resolved through the catalog. */
  instrumentId?: string;
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
  instrumentId?: string;
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
  /** Persisted branch selected when the session was last opened. */
  activeBranchId?: string;
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

/**
 * A user-visible conversation action.  Every action creates new artifacts;
 * none of the values below mean "update the previous answer in place".
 */
export type ConversationOperation = 'send' | 'retry' | 'regenerate' | 'edit' | 'fork';

/**
 * Snapshot of the workspace/security context used to start a run.  The
 * current workspace may change while a historical branch is being viewed, so
 * replaying a run must use this persisted value instead of live UI state.
 */
export interface RunContextSnapshot {
  capturedAt: number;
  workspaceContext?: WorkspaceContext;
  recentSymbols?: string[];
}

/**
 * A logical conversation branch.  `forkMessageId` is the last message from
 * the parent branch visible in this branch; messages after it are local to the
 * new branch. `null` explicitly means "start before the first parent
 * message", while `undefined` is reserved for legacy metadata. This makes
 * branch materialization deterministic and preserves the original branch
 * unchanged.
 */
export interface ConversationBranch {
  id: string;
  sessionId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  parentBranchId?: string;
  forkMessageId?: string | null;
  /** Pi's tree leaf for this branch, when the Pi runtime is in use. */
  runtimeLeafId?: string;
  /** Runtime session file created for this logical branch. */
  runtimeSessionPath?: string;
  /** Runtime entry used to create this branch from its parent. */
  runtimeForkEntryId?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  toolName?: string;
  toolCalls?: ToolCallRecord[];
  trace?: AgentTraceEvent[];
  /** Branch containing this immutable message artifact. */
  branchId?: string;
  /** Previous message in the visible branch at creation time. */
  parentMessageId?: string;
  /** Run/generation that produced this message. */
  runId?: string;
  generationId?: string;
  operation?: ConversationOperation;
  /** Message/run this operation was derived from (edit, retry, regenerate). */
  sourceMessageId?: string;
  contextSnapshot?: RunContextSnapshot;
  /** Stable entry id in the backing runtime's conversation tree. */
  runtimeEntryId?: string;
}

export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Why a run stopped. `completed` is the only success value: a run cut short by a
 * budget or a runaway loop is not an ordinary answer, so telemetry, evaluation
 * and the UI branch on this instead of treating every terminal run as success.
 */
export type StopReason =
  | 'completed'
  | 'budget_exhausted'
  | 'loop_detected'
  | 'retry_storm'
  | 'cancelled'
  | 'error';

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
  /** Conversation branch in which this generation ran. */
  branchId?: string;
  operation?: ConversationOperation;
  parentRunId?: string;
  sourceMessageId?: string;
  userMessageId?: string;
  /** Explicit generation identity; normally equal to `id`, kept for APIs. */
  generationId?: string;
  contextSnapshot?: RunContextSnapshot;
  /** Runtime identities captured for this generation's audit manifest. */
  runtimeSessionId?: string;
  runtimeSessionPath?: string;
  runtimeLeafId?: string;
  runtimeUserEntryId?: string;
  runtimeAssistantEntryId?: string;
  /** Immutable run manifest for audit/evaluation consumers. */
  manifest?: RunManifest;
  /** Machine-readable reason the run stopped; absent on records written before #17. */
  stopReason?: StopReason;
  /** The numbers behind a non-success stop (which budget ran out, which loop fired). */
  stopDetail?: Record<string, unknown>;
}

export interface RunManifest {
  runId: string;
  branchId: string;
  operation: ConversationOperation;
  inputMessageId?: string;
  parentRunId?: string;
  sourceMessageId?: string;
  contextSnapshot?: RunContextSnapshot;
  toolCallIds: string[];
  runtimeSessionId?: string;
  runtimeSessionPath?: string;
  runtimeLeafId?: string;
  runtimeUserEntryId?: string;
  runtimeAssistantEntryId?: string;
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
  /** False when a new generation reuses an inherited user message. */
  userMessageIsNew?: boolean;
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
  /** Canonical instrument id when the tool ran against a resolved listing. */
  instrumentId?: string;
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

/**
 * Runtime *infrastructure* failure codes (V8.1 §38–39): the Pi process itself
 * failed to start / stay up / speak — not a failed computation. Renderers
 * surface these as a dedicated runtime banner instead of assistant-style chat
 * messages, and the run manager skips persisting a fake assistant reply.
 */
const RUNTIME_INFRA_CODES = new Set([
  'PI_RUNTIME_NOT_FOUND',
  'PI_RUNTIME_EXITED',
  'PI_RUNTIME_ERROR',
  'PI_RUNTIME_STOPPED',
  'PI_PROTOCOL_ERROR',
  'PI_REQUEST_TIMEOUT',
  'PI_HEALTH_TIMEOUT',
  'PI_LLM_ENV_MISSING',
] as const);

export function isRuntimeInfraCode(code: string | undefined): boolean {
  if (typeof code !== 'string') return false;
  for (const candidate of RUNTIME_INFRA_CODES) {
    if (candidate === code) return true;
  }
  return false;
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
  /** Logical Folio branch that owns this runtime generation. */
  branchId?: string;
  /** Runtime session file selected for this branch. */
  sessionPath?: string;
  workspaceContext?: WorkspaceContext;
  /** V8: effective UI locale for new agent responses (spec §41–42). */
  locale?: SupportedLocale;
}

/** Request to materialize a logical branch in a runtime conversation tree. */
export interface RuntimeBranchPreparationInput {
  sessionId: string;
  branchId: string;
  parentBranchId?: string;
  parentSessionPath?: string;
  forkMessageId?: string | null;
  /** Runtime entry id of the parent message used as the native fork cursor. */
  forkRuntimeEntryId?: string;
}

/** Runtime identities returned after a branch has been prepared. */
export interface RuntimeBranchState {
  runtimeSessionId?: string;
  runtimeSessionPath?: string;
  runtimeLeafId?: string;
}

/** Stable runtime identities captured for one generation. */
export interface RuntimeRunArtifacts extends RuntimeBranchState {
  runtimeUserEntryId?: string;
  runtimeAssistantEntryId?: string;
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
    branchId?: string;
    sessionPath?: string;
    recentSymbols?: string[];
  }) => Promise<RuntimeSession>;
  run: (input: AgentRunInput) => AsyncIterable<AgentEvent>;
  /** Optional native branch operation (Pi uses its session-tree fork). */
  prepareBranch?: (input: RuntimeBranchPreparationInput) => Promise<RuntimeBranchState>;
  /** Optional runtime identities captured after a generation settles. */
  getRunArtifacts?: (input: { sessionId: string; runId: string }) => Promise<RuntimeRunArtifacts | undefined>;
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
export * from './answer-blocks.ts';
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
export * from './screening.ts';
export * from './strategy.ts';
export * from './research-diff.ts';
export * from './automation.ts';
export * from './outcome.ts';
export * from './notification.ts';
export * from './portfolio-import.ts';
export * from './performance.ts';
export * from './calibration.ts';
export * from './evaluation.ts';
export * from './locale.ts';
export * from './trace.ts';
export * from './trace-projection.ts';
export * from './instrument.ts';
export * from './instrument-catalog.ts';
