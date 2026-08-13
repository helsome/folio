import React, { createContext, useContext } from 'react';
import type {
  AgentEvent,
  Alert,
  ApiResult,
  CalcIndex,
  CredentialInfo,
  CustomProviderConfig,
  Kline,
  KlineRequest,
  LlmModel,
  LlmRuntimeState,
  LlmTestResult,
  LongBridgeStatus,
  MarketStatus,
  Message,
  NewsItem,
  Portfolio,
  ProviderStatus,
  Quote,
  Run,
  SessionMeta,
  Skill,
  StaticInfo,
  ToolDefinition,
  WorkspaceContext,
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

export interface SkillListItem {
  id: string;
  name: string;
  keywords: string[];
  enabled: boolean;
  description: string;
  riskLevel?: string;
  tier?: string;
}

export interface SkillResourceItem {
  skillId: string;
  path: string;
  kind: 'skill' | 'reference' | 'script' | 'asset' | 'other';
  size?: number;
}

export interface FinagentClient {
  window?: WindowControlsClient;
  kernel: {
    hydrate: () => Promise<ApiResult<KernelHydrate>>;
    createSession: (title?: string) => Promise<ApiResult<SessionMeta>>;
    deleteSession: (sessionId: string) => Promise<ApiResult<void>>;
    getMessages: (sessionId: string) => Promise<ApiResult<Message[]>>;
    listRuns: (sessionId: string) => Promise<ApiResult<Run[]>>;
    startRun: (
      sessionId: string,
      content: string,
      workspaceContext?: WorkspaceContext
    ) => Promise<ApiResult<Run>>;
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
    getStaticInfo: (symbol: string) => Promise<ApiResult<StaticInfo>>;
    getCalcIndex: (symbol: string) => Promise<ApiResult<CalcIndex>>;
    getMarketStatus: () => Promise<ApiResult<MarketStatus[]>>;
    getNews: (symbol: string) => Promise<ApiResult<NewsItem[]>>;
  };
  longbridge: {
    getStatus: () => Promise<ApiResult<LongBridgeStatus>>;
  };
  alerts: {
    load: () => Promise<ApiResult<Alert[]>>;
    save: (alerts: Alert[]) => Promise<ApiResult<void>>;
  };
  llm: {
    getState: () => Promise<ApiResult<LlmRuntimeState>>;
    listModels: () => Promise<ApiResult<LlmModel[]>>;
    setModel: (provider: string, modelId: string) => Promise<ApiResult<LlmRuntimeState>>;
    listThinkingLevels: () => Promise<ApiResult<string[]>>;
    setThinkingLevel: (level: string) => Promise<ApiResult<LlmRuntimeState>>;
    getProviders: () => Promise<ApiResult<ProviderStatus[]>>;
    listCredentials: () => Promise<ApiResult<CredentialInfo[]>>;
    setCredential: (provider: string, apiKey: string) => Promise<ApiResult<void>>;
    removeCredential: (provider: string) => Promise<ApiResult<void>>;
    setCustomProvider: (config: CustomProviderConfig) => Promise<ApiResult<void>>;
    removeCustomProvider: (name: string) => Promise<ApiResult<void>>;
    testProvider: (provider: string, modelId: string) => Promise<ApiResult<LlmTestResult>>;
  };
  skills: {
    list: () => Promise<ApiResult<SkillListItem[]>>;
    setEnabled: (skillId: string, enabled: boolean) => Promise<ApiResult<void>>;
    listResources: (skillId: string) => Promise<ApiResult<SkillResourceItem[]>>;
    readResource: (skillId: string, relativePath: string) => Promise<ApiResult<string>>;
  };
}

const missingClient = (operation: string) => async () =>
  ({
    ok: false,
    error: { code: 'CLIENT_UNAVAILABLE', message: `${operation} is unavailable in this environment.` },
  } as ApiResult<never>);

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
    getStaticInfo: missingClient('market.getStaticInfo'),
    getCalcIndex: missingClient('market.getCalcIndex'),
    getMarketStatus: missingClient('market.getMarketStatus'),
    getNews: missingClient('market.getNews'),
  },
  longbridge: {
    getStatus: missingClient('longbridge.getStatus'),
  },
  alerts: {
    load: missingClient('alerts.load'),
    save: missingClient('alerts.save'),
  },
  llm: {
    getState: missingClient('llm.getState'),
    listModels: missingClient('llm.listModels'),
    setModel: missingClient('llm.setModel'),
    listThinkingLevels: missingClient('llm.listThinkingLevels'),
    setThinkingLevel: missingClient('llm.setThinkingLevel'),
    getProviders: missingClient('llm.getProviders'),
    listCredentials: missingClient('llm.listCredentials'),
    setCredential: missingClient('llm.setCredential'),
    removeCredential: missingClient('llm.removeCredential'),
    setCustomProvider: missingClient('llm.setCustomProvider'),
    removeCustomProvider: missingClient('llm.removeCustomProvider'),
    testProvider: missingClient('llm.testProvider'),
  },
  skills: {
    list: missingClient('skills.list'),
    setEnabled: missingClient('skills.setEnabled'),
    listResources: missingClient('skills.listResources'),
    readResource: missingClient('skills.readResource'),
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

export type { Skill } from '@finagent/core';
