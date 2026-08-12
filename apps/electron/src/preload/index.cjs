const { contextBridge, ipcRenderer } = require('electron');

const electronAPI = {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  },
  kernel: {
    hydrate: () => ipcRenderer.invoke('kernel:hydrate'),
    createSession: (title) => ipcRenderer.invoke('sessions:create', title),
    deleteSession: (sessionId) => ipcRenderer.invoke('sessions:delete', sessionId),
    getMessages: (sessionId) => ipcRenderer.invoke('sessions:getMessages', sessionId),
    listRuns: (sessionId) => ipcRenderer.invoke('sessions:listRuns', sessionId),
    startRun: (input) => ipcRenderer.invoke('runs:start', input),
    cancelRun: (input) => ipcRenderer.invoke('runs:cancel', input),
    onAgentEvent: (callback) => {
      const listener = (_event, agentEvent) => callback(agentEvent);
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
    getQuote: (symbol) => ipcRenderer.invoke('market:getQuote', symbol),
    getKline: (request) => ipcRenderer.invoke('market:getKline', request),
    getPortfolio: () => ipcRenderer.invoke('market:getPortfolio'),
  },
  longbridge: {
    getStatus: () => ipcRenderer.invoke('longbridge:getStatus'),
  },
  alerts: {
    load: () => ipcRenderer.invoke('alerts:load'),
    save: (alerts) => ipcRenderer.invoke('alerts:save', alerts),
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
