import type {
  AgentEvent,
  ApiResult,
  CustomProviderConfig,
  WorkspaceContext,
} from '@finagent/core';
import { fallbackClient, type FinagentClient } from '@finagent/ui';

function ipcResult<T>(promise: Promise<unknown>): Promise<ApiResult<T>> {
  return promise as Promise<ApiResult<T>>;
}

function createElectronClient(): FinagentClient {
  if (!window.electronAPI) {
    return fallbackClient;
  }

  return {
    window: {
      minimize: () => window.electronAPI.window.minimize(),
      maximize: () => window.electronAPI.window.maximize(),
      close: () => window.electronAPI.window.close(),
      isMaximized: () => window.electronAPI.window.isMaximized(),
    },
    kernel: {
      hydrate: () => ipcResult(window.electronAPI.kernel.hydrate()),
      createSession: (title?: string) => ipcResult(window.electronAPI.kernel.createSession(title)),
      deleteSession: (sessionId: string) => ipcResult(window.electronAPI.kernel.deleteSession(sessionId)),
      getMessages: (sessionId: string) => ipcResult(window.electronAPI.kernel.getMessages(sessionId)),
      listRuns: (sessionId: string) => ipcResult(window.electronAPI.kernel.listRuns(sessionId)),
      startRun: (sessionId: string, content: string, workspaceContext?: WorkspaceContext) =>
        ipcResult(window.electronAPI.kernel.startRun({ sessionId, content, workspaceContext })),
      cancelRun: (sessionId: string, runId: string) =>
        ipcResult(window.electronAPI.kernel.cancelRun({ sessionId, runId })),
      onAgentEvent: (callback: (event: AgentEvent) => void) =>
        window.electronAPI.kernel.onAgentEvent((event) => callback(event as AgentEvent)),
    },
    agent: {
      getTools: () => ipcResult(window.electronAPI.agent.getTools()),
    },
    market: {
      getQuote: (symbol) => ipcResult(window.electronAPI.market.getQuote(symbol)),
      getKline: (request) => ipcResult(window.electronAPI.market.getKline(request)),
      getPortfolio: () => ipcResult(window.electronAPI.market.getPortfolio()),
      getStaticInfo: (symbol) => ipcResult(window.electronAPI.market.getStaticInfo(symbol)),
      getCalcIndex: (symbol) => ipcResult(window.electronAPI.market.getCalcIndex(symbol)),
      getMarketStatus: () => ipcResult(window.electronAPI.market.getMarketStatus()),
      getNews: (symbol) => ipcResult(window.electronAPI.market.getNews(symbol)),
    },
    longbridge: {
      getStatus: () => ipcResult(window.electronAPI.longbridge.getStatus()),
    },
    alerts: {
      load: () => ipcResult(window.electronAPI.alerts.load()),
      save: (alerts) => ipcResult(window.electronAPI.alerts.save(alerts)),
    },
    llm: {
      getState: () => ipcResult(window.electronAPI.llm.getState()),
      listModels: () => ipcResult(window.electronAPI.llm.listModels()),
      setModel: (provider, modelId) => ipcResult(window.electronAPI.llm.setModel({ provider, modelId })),
      listThinkingLevels: () => ipcResult(window.electronAPI.llm.listThinkingLevels()),
      setThinkingLevel: (level) => ipcResult(window.electronAPI.llm.setThinkingLevel({ level })),
      getProviders: () => ipcResult(window.electronAPI.llm.getProviders()),
      listCredentials: () => ipcResult(window.electronAPI.llm.listCredentials()),
      setCredential: (provider, apiKey) => ipcResult(window.electronAPI.llm.setCredential({ provider, apiKey })),
      removeCredential: (provider) => ipcResult(window.electronAPI.llm.removeCredential({ provider })),
      setCustomProvider: (config: CustomProviderConfig) => ipcResult(window.electronAPI.llm.setCustomProvider(config)),
      removeCustomProvider: (name) => ipcResult(window.electronAPI.llm.removeCustomProvider({ name })),
      testProvider: (provider, modelId) => ipcResult(window.electronAPI.llm.testProvider({ provider, modelId })),
    },
    skills: {
      list: () => ipcResult(window.electronAPI.skills.list()),
      setEnabled: (skillId, enabled) => ipcResult(window.electronAPI.skills.setEnabled({ skillId, enabled })),
      listResources: (skillId) => ipcResult(window.electronAPI.skills.listResources(skillId)),
      readResource: (skillId, relativePath) =>
        ipcResult(window.electronAPI.skills.readResource(skillId, relativePath)),
    },
  };
}

export const finagentClient: FinagentClient = createElectronClient();
