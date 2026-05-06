import React, { createContext, useContext } from 'react';
import type {
  AgentResponse,
  AgentRequest,
  Alert,
  ApiResult,
  Kline,
  KlineRequest,
  LongBridgeStatus,
  Portfolio,
  Quote,
  ToolDefinition,
} from '@finagent/core';

export interface WindowControlsClient {
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
}

export interface FinagentClient {
  window?: WindowControlsClient;
  agent: {
    send: (request: string | AgentRequest) => Promise<ApiResult<AgentResponse>>;
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
  agent: {
    send: missingClient('agent.send'),
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
