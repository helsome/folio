const { contextBridge, ipcRenderer } = require('electron');

const electronAPI = {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  },
  agent: {
    send: (message) => ipcRenderer.invoke('agent:send', message),
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
