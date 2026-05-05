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
}

export interface ToolDefinition {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
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