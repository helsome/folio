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

export type AlertType = 'price_above' | 'price_below' | 'news' | 'rating_change';

export interface Alert {
  id: string;
  symbol: string;
  type: AlertType;
  value: number;
  enabled: boolean;
  triggered: boolean;
  createdAt: number;
  triggeredAt?: number;
}

export interface NewsItem {
  id: string;
  title: string;
  summary: string;
  url: string;
  timestamp: number;
  symbols: string[];
}

export interface AnalystRating {
  symbol: string;
  rating: 'buy' | 'neutral' | 'sell';
  targetPrice: number;
  analyst: string;
  firm: string;
  timestamp: number;
}

export interface Session {
  id: string;
  title: string;
  messages: Message[];
  status: 'idle' | 'loading' | 'error';
  createdAt: number;
  updatedAt: number;
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
