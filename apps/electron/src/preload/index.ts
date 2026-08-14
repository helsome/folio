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
    loadRules: () => Promise<unknown>;
    saveRules: (rules: unknown) => Promise<unknown>;
    listEvents: () => Promise<unknown>;
    onTriggered: (callback: (event: unknown) => void) => () => void;
  };
  capabilities: {
    list: () => Promise<unknown>;
  };
  research: {
    start: (input: { symbol: string; strategyId?: string }) => Promise<unknown>;
    cancel: (input: { runId: string }) => Promise<unknown>;
    listRuns: () => Promise<unknown>;
    getRun: (input: { runId: string }) => Promise<unknown>;
    listReports: (input: { symbol?: string }) => Promise<unknown>;
    getReport: (input: { reportId: string }) => Promise<unknown>;
    getDiff: (input: { symbol: string }) => Promise<unknown>;
  };
  thesis: {
    list: (symbol?: string) => Promise<unknown>;
    getReport: (symbol: string) => Promise<unknown>;
    saveFromReport: (symbol: string) => Promise<unknown>;
    reEvaluate: (symbol: string) => Promise<unknown>;
    update: (thesis: unknown) => Promise<unknown>;
    listImpacts: (symbol: string) => Promise<unknown>;
    onImpact: (callback: (impact: unknown) => void) => () => void;
  };
  compare: {
    build: (symbols: string[]) => Promise<unknown>;
  };
  portfolioRisk: {
    analyze: () => Promise<unknown>;
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
    readiness: () => Promise<unknown>;
  };
  about: {
    get: () => Promise<unknown>;
  };
  diagnostics: {
    collect: () => Promise<unknown>;
    export: () => Promise<unknown>;
  };
  health: {
    check: () => Promise<unknown>;
  };
  openExternal: (url: string) => Promise<unknown>;
  connections: {
    list: () => Promise<unknown>;
    connect: (input: { providerId: string }) => Promise<unknown>;
    cancelConnect: (input: { providerId: string }) => Promise<unknown>;
    disconnect: (input: { providerId: string }) => Promise<unknown>;
    test: (input: { providerId: string }) => Promise<unknown>;
    setConfig: (input: { providerId: string; config: { apiKey?: string } }) => Promise<unknown>;
    coverage: () => Promise<unknown>;
    onChanged: (callback: (entries: unknown) => void) => () => void;
  };
  onboarding: {
    getCompleted: () => Promise<unknown>;
    setCompleted: (input: { completed: boolean }) => Promise<unknown>;
  };
  screening: {
    run: (input: unknown) => Promise<unknown>;
    listRuns: () => Promise<unknown>;
    getRun: (input: { runId: string }) => Promise<unknown>;
  };
  outcome: {
    listOpinions: (input: { symbol?: string }) => Promise<unknown>;
    listOutcomes: (input: { symbol?: string }) => Promise<unknown>;
    evaluateDue: () => Promise<unknown>;
  };
  portfolioImport: {
    parse: (input: { source: string; text: string }) => Promise<unknown>;
    confirm: (input: unknown) => Promise<unknown>;
    listManual: () => Promise<unknown>;
  };
  pulse: {
    snapshot: (input: unknown) => Promise<unknown>;
  };
  performance: {
    skill: (input: { horizon: string }) => Promise<unknown>;
    strategy: (input: { horizon: string }) => Promise<unknown>;
    calibration: (input: { horizon: string }) => Promise<unknown>;
    strategyCalibration: (input: { horizon: string }) => Promise<unknown>;
  };
  automation: {
    listRules: () => Promise<unknown>;
    saveRule: (input: { rule: unknown }) => Promise<unknown>;
    removeRule: (input: { ruleId: string }) => Promise<unknown>;
    runRule: (input: { ruleId: string }) => Promise<unknown>;
    listRuns: () => Promise<unknown>;
    buildBrief: () => Promise<unknown>;
    onNotification: (callback: (event: unknown) => void) => () => void;
  };
  export: {
    markdown: (input: { reportId: string }) => Promise<unknown>;
    shareCard: (input: { reportId: string }) => Promise<unknown>;
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
    loadRules: () => ipcRenderer.invoke('alerts:loadRules'),
    saveRules: (rules: unknown) => ipcRenderer.invoke('alerts:saveRules', rules),
    listEvents: () => ipcRenderer.invoke('alerts:listEvents'),
    onTriggered: (callback: (event: unknown) => void) => {
      const listener = (_event: unknown, payload: unknown) => callback(payload);
      ipcRenderer.on('alerts:triggered', listener);
      return () => {
        ipcRenderer.removeListener('alerts:triggered', listener);
      };
    },
  },
  capabilities: {
    list: () => ipcRenderer.invoke('capabilities:list'),
  },
  research: {
    start: (input: { symbol: string; strategyId?: string }) => ipcRenderer.invoke('research:start', input),
    cancel: (input: { runId: string }) => ipcRenderer.invoke('research:cancel', input),
    listRuns: () => ipcRenderer.invoke('research:listRuns'),
    getRun: (input: { runId: string }) => ipcRenderer.invoke('research:getRun', input),
    listReports: (input: { symbol?: string }) => ipcRenderer.invoke('research:listReports', input),
    getReport: (input: { reportId: string }) => ipcRenderer.invoke('research:getReport', input),
    getDiff: (input: { symbol: string }) => ipcRenderer.invoke('research:getDiff', input),
  },
  thesis: {
    list: (symbol?: string) => ipcRenderer.invoke('thesis:list', symbol),
    getReport: (symbol: string) => ipcRenderer.invoke('thesis:getReport', symbol),
    saveFromReport: (symbol: string) => ipcRenderer.invoke('thesis:saveFromReport', symbol),
    reEvaluate: (symbol: string) => ipcRenderer.invoke('thesis:reEvaluate', symbol),
    update: (thesis: unknown) => ipcRenderer.invoke('thesis:update', thesis),
    listImpacts: (symbol: string) => ipcRenderer.invoke('thesis:listImpacts', symbol),
    onImpact: (callback: (impact: unknown) => void) => {
      const listener = (_event: unknown, payload: unknown) => callback(payload);
      ipcRenderer.on('thesis:impact', listener);
      return () => {
        ipcRenderer.removeListener('thesis:impact', listener);
      };
    },
  },
  compare: {
    build: (symbols: string[]) => ipcRenderer.invoke('compare:build', { symbols }),
  },
  portfolioRisk: {
    analyze: () => ipcRenderer.invoke('portfolioRisk:analyze'),
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
    readiness: () => ipcRenderer.invoke('skills:readiness'),
  },
  about: {
    get: () => ipcRenderer.invoke('app:about'),
  },
  diagnostics: {
    collect: () => ipcRenderer.invoke('diagnostics:collect'),
    export: () => ipcRenderer.invoke('diagnostics:export'),
  },
  health: {
    check: () => ipcRenderer.invoke('health:check'),
  },
  openExternal: (url: string) => ipcRenderer.invoke('openExternal', url),
  connections: {
    list: () => ipcRenderer.invoke('connections:list'),
    connect: (input: { providerId: string }) => ipcRenderer.invoke('connections:connect', input),
    cancelConnect: (input: { providerId: string }) => ipcRenderer.invoke('connections:cancelConnect', input),
    disconnect: (input: { providerId: string }) => ipcRenderer.invoke('connections:disconnect', input),
    test: (input: { providerId: string }) => ipcRenderer.invoke('connections:test', input),
    setConfig: (input: { providerId: string; config: { apiKey?: string } }) =>
      ipcRenderer.invoke('connections:setConfig', input),
    coverage: () => ipcRenderer.invoke('connections:coverage'),
    onChanged: (callback: (entries: unknown) => void) => {
      const listener = (_event: unknown, entries: unknown) => callback(entries);
      ipcRenderer.on('connections:changed', listener);
      return () => {
        ipcRenderer.removeListener('connections:changed', listener);
      };
    },
  },
  onboarding: {
    getCompleted: () => ipcRenderer.invoke('onboarding:getCompleted'),
    setCompleted: (input: { completed: boolean }) => ipcRenderer.invoke('onboarding:setCompleted', input),
  },
  screening: {
    run: (input: unknown) => ipcRenderer.invoke('screening:run', input),
    listRuns: () => ipcRenderer.invoke('screening:listRuns'),
    getRun: (input: { runId: string }) => ipcRenderer.invoke('screening:getRun', input),
  },
  outcome: {
    listOpinions: (input: { symbol?: string }) => ipcRenderer.invoke('outcome:listOpinions', input),
    listOutcomes: (input: { symbol?: string }) => ipcRenderer.invoke('outcome:listOutcomes', input),
    evaluateDue: () => ipcRenderer.invoke('outcome:evaluateDue'),
  },
  portfolioImport: {
    parse: (input: { source: string; text: string }) => ipcRenderer.invoke('import:parse', input),
    confirm: (input: unknown) => ipcRenderer.invoke('import:confirm', input),
    listManual: () => ipcRenderer.invoke('portfolio:listManual'),
  },
  pulse: {
    snapshot: (input: unknown) => ipcRenderer.invoke('pulse:snapshot', input),
  },
  performance: {
    skill: (input: { horizon: string }) => ipcRenderer.invoke('performance:skill', input),
    strategy: (input: { horizon: string }) => ipcRenderer.invoke('performance:strategy', input),
    calibration: (input: { horizon: string }) => ipcRenderer.invoke('performance:calibration', input),
    strategyCalibration: (input: { horizon: string }) =>
      ipcRenderer.invoke('performance:strategyCalibration', input),
  },
  automation: {
    listRules: () => ipcRenderer.invoke('automation:listRules'),
    saveRule: (input: { rule: unknown }) => ipcRenderer.invoke('automation:saveRule', input),
    removeRule: (input: { ruleId: string }) => ipcRenderer.invoke('automation:removeRule', input),
    runRule: (input: { ruleId: string }) => ipcRenderer.invoke('automation:runRule', input),
    listRuns: () => ipcRenderer.invoke('automation:listRuns'),
    buildBrief: () => ipcRenderer.invoke('automation:buildBrief'),
    onNotification: (callback: (event: unknown) => void) => {
      const listener = (_event: unknown, event: unknown) => callback(event);
      ipcRenderer.on('notification:event', listener);
      return () => {
        ipcRenderer.removeListener('notification:event', listener);
      };
    },
  },
  export: {
    markdown: (input: { reportId: string }) => ipcRenderer.invoke('export:markdown', input),
    shareCard: (input: { reportId: string }) => ipcRenderer.invoke('export:shareCard', input),
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
