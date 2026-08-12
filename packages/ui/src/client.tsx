import React, { createContext, useContext } from 'react';
import type {
  AgentEvent,
  Alert,
  ApiResult,
  Kline,
  KlineRequest,
  LongBridgeStatus,
  Message,
  Portfolio,
  Quote,
  Run,
  SessionMeta,
  ToolDefinition,
} from '@finagent/core';

export interface WindowControlsClient {
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
}

export interface KernelHydrate {
  sessions: SessionMeta[];
}

export interface FinagentClient {
  window?: WindowControlsClient;
  kernel: {
    hydrate: () => Promise<ApiResult<KernelHydrate>>;
    createSession: (title?: string) => Promise<ApiResult<SessionMeta>>;
    deleteSession: (sessionId: string) => Promise<ApiResult<void>>;
    getMessages: (sessionId: string) => Promise<ApiResult<Message[]>>;
    listRuns: (sessionId: string) => Promise<ApiResult<Run[]>>;
    startRun: (sessionId: string, content: string) => Promise<ApiResult<Run>>;
    cancelRun: (sessionId: string, runId: string) => Promise<ApiResult<void>>;
    onAgentEvent: (callback: (event: AgentEvent) => void) => () => void;
  };
  agent: {
    getTools: () => Promise<ApiResult<ToolDefinition[]>>;
  };
  market: {
    getQuote: (symbol: string) => Promise<ApiResult<Quote>>;
    getKline: (request: KlineRequest) => Promise<ApiResult<Kline[]>>;
    getPortfolio: () => Promise<ApiResult<Portfolio>>;
  };
  longbridge: {
    getStatus: () => Promise<ApiResult<LongBridgeStatus>>;
  };
  alerts: {
    load: () => Promise<ApiResult<Alert[]>>;
    save: (alerts: Alert[]) => Promise<ApiResult<void>>;
  };
}

const missingClient = (operation: string) => async () => ({
  ok: false as const,
  error: {
    code: 'CLIENT_UNAVAILABLE',
    message: `Folio client is not available for ${operation}.`,
  },
});

export const fallbackClient: FinagentClient = {
  kernel: {
    hydrate: missingClient('kernel.hydrate'),
    createSession: missingClient('kernel.createSession'),
    deleteSession: missingClient('kernel.deleteSession'),
    getMessages: missingClient('kernel.getMessages'),
    listRuns: missingClient('kernel.listRuns'),
    startRun: missingClient('kernel.startRun'),
    cancelRun: missingClient('kernel.cancelRun'),
    onAgentEvent: () => () => undefined,
  },
  agent: {
    getTools: missingClient('agent.getTools'),
  },
  market: {
    getQuote: missingClient('market.getQuote'),
    getKline: missingClient('market.getKline'),
    getPortfolio: missingClient('market.getPortfolio'),
  },
  longbridge: {
    getStatus: missingClient('longbridge.getStatus'),
  },
  alerts: {
    load: missingClient('alerts.load'),
    save: missingClient('alerts.save'),
  },
};

const FinagentClientContext = createContext<FinagentClient>(fallbackClient);

export function FinagentClientProvider({
  client,
  children,
}: {
  client: FinagentClient;
  children: React.ReactNode;
}) {
  return (
    <FinagentClientContext.Provider value={client}>
      {children}
    </FinagentClientContext.Provider>
  );
}

export function useFinagentClient(): FinagentClient {
  return useContext(FinagentClientContext);
}
