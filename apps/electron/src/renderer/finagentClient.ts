import type { AgentEvent, ApiResult } from '@finagent/core';
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
      startRun: (sessionId: string, content: string) =>
        ipcResult(window.electronAPI.kernel.startRun({ sessionId, content })),
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
