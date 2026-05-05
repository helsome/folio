import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronAPI {
  window: {
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
  };
  agent: {
    send: (message: unknown) => Promise<unknown>;
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
  agent: {
    send: (message: unknown) => ipcRenderer.invoke('agent:send', message),
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
