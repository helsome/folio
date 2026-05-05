import type { ApiResult } from '@finagent/core';
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
    agent: {
      send: (request) => ipcResult(window.electronAPI.agent.send(request)),
      getTools: () => ipcResult(window.electronAPI.agent.getTools()),
    },
    market: {
      getQuote: (symbol) => ipcResult(window.electronAPI.market.getQuote(symbol)),
      getKline: (request) => ipcResult(window.electronAPI.market.getKline(request)),
      getPortfolio: () => ipcResult(window.electronAPI.market.getPortfolio()),
    },
    longbridge: {
      getStatus: () => ipcResult(window.electronAPI.longbridge.getStatus()),
    },
    alerts: {
      load: () => ipcResult(window.electronAPI.alerts.load()),
      save: (alerts) => ipcResult(window.electronAPI.alerts.save(alerts)),
    },
  };
}

export const finagentClient: FinagentClient = createElectronClient();
