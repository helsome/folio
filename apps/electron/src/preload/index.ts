import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronAPI {
  window: {
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
  };
  piAgent: {
    send: (message: unknown) => Promise<unknown>;
    getTools: () => Promise<unknown[]>;
    onResponse: (callback: (response: unknown) => void) => () => void;
  };
}

const electronAPI: ElectronAPI = {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  },
  piAgent: {
    send: (message: unknown) => ipcRenderer.invoke('pi-agent:send', message),
    getTools: () => ipcRenderer.invoke('pi-agent:getTools'),
    onResponse: (callback: (response: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, response: unknown) => callback(response);
      ipcRenderer.on('pi-agent:response', handler);
      return () => ipcRenderer.removeListener('pi-agent:response', handler);
    },
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}