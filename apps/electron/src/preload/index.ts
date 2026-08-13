import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronAPI {
  window: {
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
  };
  kernel: {
    hydrate: () => Promise<unknown>;
    createSession: (title?: string) => Promise<unknown>;
    deleteSession: (sessionId: string) => Promise<unknown>;
    getMessages: (sessionId: string) => Promise<unknown>;
    listRuns: (sessionId: string) => Promise<unknown>;
    startRun: (input: {
      sessionId: string;
      content: string;
      workspaceContext?: unknown;
    }) => Promise<unknown>;
    cancelRun: (input: { sessionId: string; runId: string }) => Promise<unknown>;
    onAgentEvent: (callback: (event: unknown) => void) => () => void;
  };
  agent: {
    getTools: () => Promise<unknown>;
  };
  market: {
    getQuote: (symbol: string) => Promise<unknown>;
    getKline: (request: { symbol: string; period?: string; limit?: number }) => Promise<unknown>;
    getPortfolio: () => Promise<unknown>;
    getStaticInfo: (symbol: string) => Promise<unknown>;
    getCalcIndex: (symbol: string) => Promise<unknown>;
    getMarketStatus: () => Promise<unknown>;
    getNews: (symbol: string) => Promise<unknown>;
  };
  longbridge: {
    getStatus: () => Promise<unknown>;
  };
  alerts: {
    load: () => Promise<unknown>;
    save: (alerts: unknown) => Promise<unknown>;
  };
  llm: {
    getState: () => Promise<unknown>;
    listModels: () => Promise<unknown>;
    setModel: (input: { provider: string; modelId: string }) => Promise<unknown>;
    listThinkingLevels: () => Promise<unknown>;
    setThinkingLevel: (input: { level: string }) => Promise<unknown>;
    getProviders: () => Promise<unknown>;
    listCredentials: () => Promise<unknown>;
    setCredential: (input: { provider: string; apiKey: string }) => Promise<unknown>;
    removeCredential: (input: { provider: string }) => Promise<unknown>;
    setCustomProvider: (input: unknown) => Promise<unknown>;
    removeCustomProvider: (input: { name: string }) => Promise<unknown>;
    testProvider: (input: { provider: string; modelId: string }) => Promise<unknown>;
  };
  skills: {
    list: () => Promise<unknown>;
    setEnabled: (input: { skillId: string; enabled: boolean }) => Promise<unknown>;
    listResources: (skillId: string) => Promise<unknown>;
    readResource: (skillId: string, relativePath: string) => Promise<unknown>;
  };
}

const electronAPI: ElectronAPI = {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  },
  kernel: {
    hydrate: () => ipcRenderer.invoke('kernel:hydrate'),
    createSession: (title?: string) => ipcRenderer.invoke('sessions:create', title),
    deleteSession: (sessionId: string) => ipcRenderer.invoke('sessions:delete', sessionId),
    getMessages: (sessionId: string) => ipcRenderer.invoke('sessions:getMessages', sessionId),
    listRuns: (sessionId: string) => ipcRenderer.invoke('sessions:listRuns', sessionId),
    startRun: (input: {
      sessionId: string;
      content: string;
      workspaceContext?: unknown;
    }) => ipcRenderer.invoke('runs:start', input),
    cancelRun: (input: { sessionId: string; runId: string }) => ipcRenderer.invoke('runs:cancel', input),
    onAgentEvent: (callback: (event: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, agentEvent: unknown) => callback(agentEvent);
      ipcRenderer.on('agent:event', listener);
      return () => {
        ipcRenderer.removeListener('agent:event', listener);
      };
    },
  },
  agent: {
    getTools: () => ipcRenderer.invoke('agent:getTools'),
  },
  market: {
    getQuote: (symbol: string) => ipcRenderer.invoke('market:getQuote', symbol),
    getKline: (request: { symbol: string; period?: string; limit?: number }) =>
      ipcRenderer.invoke('market:getKline', request),
    getPortfolio: () => ipcRenderer.invoke('market:getPortfolio'),
    getStaticInfo: (symbol: string) => ipcRenderer.invoke('market:getStaticInfo', symbol),
    getCalcIndex: (symbol: string) => ipcRenderer.invoke('market:getCalcIndex', symbol),
    getMarketStatus: () => ipcRenderer.invoke('market:getMarketStatus'),
    getNews: (symbol: string) => ipcRenderer.invoke('market:getNews', symbol),
  },
  longbridge: {
    getStatus: () => ipcRenderer.invoke('longbridge:getStatus'),
  },
  alerts: {
    load: () => ipcRenderer.invoke('alerts:load'),
    save: (alerts: unknown) => ipcRenderer.invoke('alerts:save', alerts),
  },
  llm: {
    getState: () => ipcRenderer.invoke('llm:getState'),
    listModels: () => ipcRenderer.invoke('llm:listModels'),
    setModel: (input: { provider: string; modelId: string }) => ipcRenderer.invoke('llm:setModel', input),
    listThinkingLevels: () => ipcRenderer.invoke('llm:listThinkingLevels'),
    setThinkingLevel: (input: { level: string }) => ipcRenderer.invoke('llm:setThinkingLevel', input),
    getProviders: () => ipcRenderer.invoke('llm:getProviders'),
    listCredentials: () => ipcRenderer.invoke('llm:listCredentials'),
    setCredential: (input: { provider: string; apiKey: string }) => ipcRenderer.invoke('llm:setCredential', input),
    removeCredential: (input: { provider: string }) => ipcRenderer.invoke('llm:removeCredential', input),
    setCustomProvider: (input: unknown) => ipcRenderer.invoke('llm:setCustomProvider', input),
    removeCustomProvider: (input: { name: string }) => ipcRenderer.invoke('llm:removeCustomProvider', input),
    testProvider: (input: { provider: string; modelId: string }) => ipcRenderer.invoke('llm:testProvider', input),
  },
  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
    setEnabled: (input: { skillId: string; enabled: boolean }) => ipcRenderer.invoke('skills:setEnabled', input),
    listResources: (skillId: string) => ipcRenderer.invoke('skills:listResources', skillId),
    readResource: (skillId: string, relativePath: string) =>
      ipcRenderer.invoke('skills:readResource', skillId, relativePath),
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
