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
    startRun: (input: { sessionId: string; content: string }) => Promise<unknown>;
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
  };
  longbridge: {
    getStatus: () => Promise<unknown>;
  };
  alerts: {
    load: () => Promise<unknown>;
    save: (alerts: unknown) => Promise<unknown>;
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
    startRun: (input: { sessionId: string; content: string }) => ipcRenderer.invoke('runs:start', input),
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
  },
  longbridge: {
    getStatus: () => ipcRenderer.invoke('longbridge:getStatus'),
  },
  alerts: {
    load: () => ipcRenderer.invoke('alerts:load'),
    save: (alerts: unknown) => ipcRenderer.invoke('alerts:save', alerts),
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
