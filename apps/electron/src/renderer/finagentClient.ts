import type {
  AgentEvent,
  AlertTriggerEvent,
  ApiResult,
  CustomProviderConfig,
  ThesisImpact,
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
      loadRules: () => ipcResult(window.electronAPI.alerts.loadRules()),
      saveRules: (rules) => ipcResult(window.electronAPI.alerts.saveRules(rules)),
      listEvents: () => ipcResult(window.electronAPI.alerts.listEvents()),
      onTriggered: (callback) =>
        window.electronAPI.alerts.onTriggered((event) => callback(event as AlertTriggerEvent)),
    },
    capabilities: {
      list: () => ipcResult(window.electronAPI.capabilities.list()),
    },
    research: {
      start: (input) => ipcResult(window.electronAPI.research.start(input)),
      cancel: (input) => ipcResult(window.electronAPI.research.cancel(input)),
      listRuns: () => ipcResult(window.electronAPI.research.listRuns()),
      getRun: (input) => ipcResult(window.electronAPI.research.getRun(input)),
      listReports: (input) => ipcResult(window.electronAPI.research.listReports(input)),
      getReport: (input) => ipcResult(window.electronAPI.research.getReport(input)),
      getDiff: (input) => ipcResult(window.electronAPI.research.getDiff(input)),
    },
    thesis: {
      list: (symbol?) => ipcResult(window.electronAPI.thesis.list(symbol)),
      getReport: (symbol) => ipcResult(window.electronAPI.thesis.getReport(symbol)),
      saveFromReport: (symbol) => ipcResult(window.electronAPI.thesis.saveFromReport(symbol)),
      reEvaluate: (symbol) => ipcResult(window.electronAPI.thesis.reEvaluate(symbol)),
      update: (thesis) => ipcResult(window.electronAPI.thesis.update(thesis)),
      listImpacts: (symbol) => ipcResult(window.electronAPI.thesis.listImpacts(symbol)),
      onImpact: (callback) =>
        window.electronAPI.thesis.onImpact((impact) => callback(impact as ThesisImpact)),
    },
    compare: {
      build: (symbols) => ipcResult(window.electronAPI.compare.build(symbols)),
    },
    portfolioRisk: {
      analyze: () => ipcResult(window.electronAPI.portfolioRisk.analyze()),
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
      readiness: () => ipcResult(window.electronAPI.skills.readiness()),
    },
    about: {
      get: () => ipcResult(window.electronAPI.about.get()),
    },
    diagnostics: {
      collect: () => ipcResult(window.electronAPI.diagnostics.collect()),
      export: () => ipcResult(window.electronAPI.diagnostics.export()),
    },
    health: {
      check: () => ipcResult(window.electronAPI.health.check()),
    },
    openExternal: (url) => ipcResult(window.electronAPI.openExternal(url)),
    connections: {
      list: () => ipcResult(window.electronAPI.connections.list()),
      connect: (providerId) => ipcResult(window.electronAPI.connections.connect({ providerId })),
      cancelConnect: (providerId) => ipcResult(window.electronAPI.connections.cancelConnect({ providerId })),
      disconnect: (providerId) => ipcResult(window.electronAPI.connections.disconnect({ providerId })),
      test: (providerId) => ipcResult(window.electronAPI.connections.test({ providerId })),
      setConfig: (providerId, config) => ipcResult(window.electronAPI.connections.setConfig({ providerId, config })),
      coverage: () => ipcResult(window.electronAPI.connections.coverage()),
      onChanged: (callback) =>
        window.electronAPI.connections.onChanged((entries) =>
          callback(entries as Parameters<typeof callback>[0])
        ),
    },
    onboarding: {
      getCompleted: () => ipcResult(window.electronAPI.onboarding.getCompleted()),
      setCompleted: (completed: boolean) =>
        ipcResult(window.electronAPI.onboarding.setCompleted({ completed })),
    },
    screening: {
      run: (input) => ipcResult(window.electronAPI.screening.run(input)),
      listRuns: () => ipcResult(window.electronAPI.screening.listRuns()),
      getRun: (input) => ipcResult(window.electronAPI.screening.getRun(input)),
    },
    outcome: {
      listOpinions: (input) => ipcResult(window.electronAPI.outcome.listOpinions(input)),
      listOutcomes: (input) => ipcResult(window.electronAPI.outcome.listOutcomes(input)),
      evaluateDue: () => ipcResult(window.electronAPI.outcome.evaluateDue()),
    },
    pulse: {
      snapshot: (input) => ipcResult(window.electronAPI.pulse.snapshot(input)),
    },
    performance: {
      skill: (input) => ipcResult(window.electronAPI.performance.skill(input)),
      strategy: (input) => ipcResult(window.electronAPI.performance.strategy(input)),
      calibration: (input) => ipcResult(window.electronAPI.performance.calibration(input)),
      strategyCalibration: (input) =>
        ipcResult(window.electronAPI.performance.strategyCalibration(input)),
    },
    automation: {
      listRules: () => ipcResult(window.electronAPI.automation.listRules()),
      saveRule: (rule) => ipcResult(window.electronAPI.automation.saveRule({ rule })),
      removeRule: (ruleId) => ipcResult(window.electronAPI.automation.removeRule({ ruleId })),
      runRule: (input) => ipcResult(window.electronAPI.automation.runRule(input)),
      listRuns: () => ipcResult(window.electronAPI.automation.listRuns()),
      buildBrief: () => ipcResult(window.electronAPI.automation.buildBrief()),
    },
    evaluation: {
      getSettings: () => ipcResult(window.electronAPI.evaluation.getSettings()),
      setSettings: (input) => ipcResult(window.electronAPI.evaluation.setSettings(input)),
      setCredential: (apiKey) => ipcResult(window.electronAPI.evaluation.setCredential({ apiKey })),
      removeCredential: () => ipcResult(window.electronAPI.evaluation.removeCredential()),
      testConnection: () => ipcResult(window.electronAPI.evaluation.testConnection()),
      listExperiments: () => ipcResult(window.electronAPI.evaluation.listExperiments()),
      getExperiment: (id) => ipcResult(window.electronAPI.evaluation.getExperiment({ id })),
      getCase: (id) => ipcResult(window.electronAPI.evaluation.getCase({ id })),
      listBaselines: () => ipcResult(window.electronAPI.evaluation.listBaselines()),
      submitFeedback: (input) => ipcResult(window.electronAPI.evaluation.submitFeedback(input)),
      listFeedback: () => ipcResult(window.electronAPI.evaluation.listFeedback()),
      status: () => ipcResult(window.electronAPI.evaluation.status()),
    },
  };
}

export const finagentClient: FinagentClient = createElectronClient();
