import React, { createContext, useContext } from 'react';
import type {
  AgentEvent,
  AlertRule,
  AlertTriggerEvent,
  ApiResult,
  CalcIndex,
  Comparison,
  CredentialInfo,
  CustomProviderConfig,
  EvaluationBaseline,
  EvaluationCase,
  EvaluationExperiment,
  EvaluationResultRecord,
  EvaluationRun,
  EvaluationSettings,
  InvestmentThesis,
  Kline,
  KlineRequest,
  LangSmithConnectionStatus,
  LlmModel,
  LlmRuntimeState,
  LlmTestResult,
  LongBridgeStatus,
  MarketStatus,
  Message,
  NewsItem,
  PortfolioSnapshot,
  PortfolioRiskReport,
  ProviderCoverage,
  ProviderHealth,
  ProviderStatus,
  Quote,
  ResearchDiff,
  ResearchReport,
  PerformanceHorizon,
  SkillPerformance,
  StrategyPerformance,
  SkillCalibration,
  StrategyCalibration,
  ResearchRunSummary,
  ResearchOpinion,
  ResearchOutcome,
  Run,
  SessionMeta,
  Skill,
  SkillReadiness,
  StaticInfo,
  ThesisImpact,
  ToolDefinition,
  WorkspaceContext,
  AppPreferencesSnapshot,
  LocalePreference,
} from '@finagent/core';
import type { ConnectionsChannel, HealthChannel } from './client/connections';
import type { DiagnosticsBundle } from './client/diagnostics';
import type { MarketPulseSnapshot } from './client/pulse';
import type { ScreeningChannel } from './client/screening';
import type { AutomationChannel } from './client/automation';

/** Renderer-safe capability metadata (schemas never cross IPC). */
export interface CapabilityMetadata {
  id: string;
  name: string;
  description: string;
  category: string;
  riskLevel: string;
  auth: string;
  toolName: string;
}

export interface WindowControlsClient {
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
}

export interface KernelHydrate {
  sessions: SessionMeta[];
}

export interface AboutInfo {
  version: string;
  channel: string;
  build: string;
}

export interface SkillListItem {
  id: string;
  name: string;
  keywords: string[];
  enabled: boolean;
  description: string;
  riskLevel?: string;
  tier?: string;
  /** Parsed from SKILL.md frontmatter; absent until the main process maps it. */
  version?: string;
  /** Parsed from SKILL.md frontmatter; absent until the main process maps it. */
  author?: string;
  source: 'bundled' | 'user';
}

export interface SkillResourceItem {
  skillId: string;
  path: string;
  kind: 'skill' | 'reference' | 'script' | 'asset' | 'other';
  size?: number;
}

export interface LocalSkillInstallResult {
  canceled: boolean;
  skillId?: string;
  name?: string;
  source?: 'user';
}

/** Renderer-facing evaluation DTOs (spec §62-69). Never carries secrets. */
export interface EvaluationFeedbackItem {
  id: string;
  caseId: string;
  runId?: string;
  verdict: 'good' | 'bad';
  note?: string;
  createdAt: number;
}

export interface EvaluationExperimentDetail {
  experiment: EvaluationExperiment;
  runs: EvaluationRun[];
  results: EvaluationResultRecord[];
}

export interface EvaluationChannel {
  getSettings: () => Promise<ApiResult<{ settings: EvaluationSettings; connection: LangSmithConnectionStatus }>>;
  /** Diagnostics view: backend/tracing/privacy without credentials (spec §86). */
  status: () => Promise<
    ApiResult<{
      backend: 'langsmith' | 'local' | 'none';
      tracingEnabled: boolean;
      privacyLevel: EvaluationSettings['privacyLevel'];
      project: string;
    }>
  >;
  setSettings: (
    input: Partial<
      Pick<
        EvaluationSettings,
        'tracingEnabled' | 'langsmithProject' | 'langsmithEndpoint' | 'privacyLevel' | 'onlineEvaluationEnabled'
      >
    >
  ) => Promise<ApiResult<EvaluationSettings>>;
  setCredential: (apiKey: string) => Promise<ApiResult<void>>;
  removeCredential: () => Promise<ApiResult<void>>;
  testConnection: () => Promise<ApiResult<LangSmithConnectionStatus>>;
  listExperiments: () => Promise<ApiResult<EvaluationExperiment[]>>;
  getExperiment: (id: string) => Promise<ApiResult<EvaluationExperimentDetail | undefined>>;
  /** Benchmark case definition (prompt/expectations) for the detail view (spec §69). */
  getCase: (id: string) => Promise<ApiResult<EvaluationCase | undefined>>;
  listBaselines: () => Promise<ApiResult<EvaluationBaseline[]>>;
  submitFeedback: (input: { caseId: string; verdict: 'good' | 'bad'; note?: string }) => Promise<ApiResult<void>>;
  listFeedback: () => Promise<ApiResult<EvaluationFeedbackItem[]>>;
  /** V9.1: persisted trace-link lookup for a folio run id (reuses the store). */
  getTraceLink: (
    input: { runId: string }
  ) => Promise<
    ApiResult<{ runId: string; traceRef?: import('@finagent/core').TraceReference; recordedAt?: number } | undefined>
  >;
}

export interface FinagentClient {
  window?: WindowControlsClient;
  kernel: {
    hydrate: () => Promise<ApiResult<KernelHydrate>>;
    createSession: (title?: string) => Promise<ApiResult<SessionMeta>>;
    deleteSession: (sessionId: string) => Promise<ApiResult<void>>;
    getMessages: (sessionId: string) => Promise<ApiResult<Message[]>>;
    listRuns: (sessionId: string) => Promise<ApiResult<Run[]>>;
    startRun: (
      sessionId: string,
      content: string,
      workspaceContext?: WorkspaceContext
    ) => Promise<ApiResult<Run>>;
    cancelRun: (sessionId: string, runId: string) => Promise<ApiResult<void>>;
    onAgentEvent: (callback: (event: AgentEvent) => void) => () => void;
  };
  agent: {
    getTools: () => Promise<ApiResult<ToolDefinition[]>>;
  };
  market: {
    getQuote: (symbol: string) => Promise<ApiResult<Quote>>;
    getKline: (request: KlineRequest) => Promise<ApiResult<Kline[]>>;
    getPortfolio: () => Promise<ApiResult<PortfolioSnapshot>>;
    getStaticInfo: (symbol: string) => Promise<ApiResult<StaticInfo>>;
    getCalcIndex: (symbol: string) => Promise<ApiResult<CalcIndex>>;
    getMarketStatus: () => Promise<ApiResult<MarketStatus[]>>;
    getNews: (symbol: string) => Promise<ApiResult<NewsItem[]>>;
  };
  longbridge: {
    getStatus: () => Promise<ApiResult<LongBridgeStatus>>;
  };
  about?: {
    get: () => Promise<ApiResult<AboutInfo>>;
  };
  onboarding?: {
    getCompleted: () => Promise<ApiResult<boolean>>;
    setCompleted: (completed: boolean) => Promise<ApiResult<void>>;
  };
  /** V8: main-owned app preferences (locale). Renderer never stores it. */
  prefs?: {
    get: () => Promise<ApiResult<AppPreferencesSnapshot>>;
    update: (locale: LocalePreference) => Promise<ApiResult<AppPreferencesSnapshot>>;
  };
  alerts?: {
    loadRules: () => Promise<ApiResult<AlertRule[]>>;
    saveRules: (rules: AlertRule[]) => Promise<ApiResult<void>>;
    listEvents: () => Promise<ApiResult<AlertTriggerEvent[]>>;
    onTriggered: (callback: (event: AlertTriggerEvent) => void) => () => void;
  };
  capabilities?: {
    list: () => Promise<ApiResult<CapabilityMetadata[]>>;
  };
  research?: {
    start: (input: { symbol: string; strategyId?: string }) => Promise<ApiResult<ResearchRunSummary>>;
    cancel: (input: { runId: string }) => Promise<ApiResult<void>>;
    listRuns: () => Promise<ApiResult<ResearchRunSummary[]>>;
    getRun: (input: { runId: string }) => Promise<ApiResult<ResearchRunSummary | undefined>>;
    listReports: (input: { symbol?: string }) => Promise<ApiResult<ResearchReport[]>>;
    getReport: (input: { reportId: string }) => Promise<ApiResult<ResearchReport | undefined>>;
    getDiff: (input: { symbol: string }) => Promise<ApiResult<ResearchDiff | undefined>>;
  };
  screening?: ScreeningChannel;
  outcome?: {
    listOpinions: (input: { symbol?: string }) => Promise<ApiResult<ResearchOpinion[]>>;
    listOutcomes: (input: { symbol?: string }) => Promise<ApiResult<ResearchOutcome[]>>;
    evaluateDue: () => Promise<ApiResult<ResearchOutcome[]>>;
  };
  pulse?: {
    snapshot: (input: unknown) => Promise<ApiResult<MarketPulseSnapshot>>;
  };
  performance?: {
    skill: (input: { horizon: PerformanceHorizon }) => Promise<ApiResult<SkillPerformance[]>>;
    strategy: (input: { horizon: PerformanceHorizon }) => Promise<ApiResult<StrategyPerformance[]>>;
    calibration: (input: { horizon: PerformanceHorizon }) => Promise<ApiResult<SkillCalibration[]>>;
    strategyCalibration: (input: { horizon: PerformanceHorizon }) => Promise<ApiResult<StrategyCalibration[]>>;
  };
  automation?: AutomationChannel;
  thesis?: {
    list: (symbol?: string) => Promise<ApiResult<InvestmentThesis[]>>;
    getReport: (symbol: string) => Promise<ApiResult<ResearchReport | null>>;
    saveFromReport: (symbol: string) => Promise<ApiResult<InvestmentThesis>>;
    reEvaluate: (symbol: string) => Promise<ApiResult<ThesisImpact>>;
    update: (thesis: InvestmentThesis) => Promise<ApiResult<InvestmentThesis>>;
    listImpacts: (symbol: string) => Promise<ApiResult<ThesisImpact[]>>;
    onImpact: (callback: (impact: ThesisImpact) => void) => () => void;
  };
  compare?: {
    build: (symbols: string[]) => Promise<ApiResult<Comparison>>;
  };
  portfolioRisk?: {
    analyze: () => Promise<ApiResult<PortfolioRiskReport>>;
  };
  llm: {
    getState: () => Promise<ApiResult<LlmRuntimeState>>;
    listModels: () => Promise<ApiResult<LlmModel[]>>;
    setModel: (provider: string, modelId: string) => Promise<ApiResult<LlmRuntimeState>>;
    listThinkingLevels: () => Promise<ApiResult<string[]>>;
    setThinkingLevel: (level: string) => Promise<ApiResult<LlmRuntimeState>>;
    getProviders: () => Promise<ApiResult<ProviderStatus[]>>;
    listCredentials: () => Promise<ApiResult<CredentialInfo[]>>;
    setCredential: (provider: string, apiKey: string) => Promise<ApiResult<void>>;
    removeCredential: (provider: string) => Promise<ApiResult<void>>;
    setCustomProvider: (config: CustomProviderConfig) => Promise<ApiResult<void>>;
    removeCustomProvider: (name: string) => Promise<ApiResult<void>>;
    testProvider: (provider: string, modelId: string) => Promise<ApiResult<LlmTestResult>>;
  };
  skills: {
    list: () => Promise<ApiResult<SkillListItem[]>>;
    setEnabled: (skillId: string, enabled: boolean) => Promise<ApiResult<void>>;
    listResources: (skillId: string) => Promise<ApiResult<SkillResourceItem[]>>;
    readResource: (skillId: string, relativePath: string) => Promise<ApiResult<string>>;
    readiness: () => Promise<ApiResult<SkillReadiness[]>>;
    installLocal: () => Promise<ApiResult<LocalSkillInstallResult>>;
    remove: (skillId: string) => Promise<ApiResult<void>>;
  };
  diagnostics?: {
    collect: () => Promise<ApiResult<DiagnosticsBundle>>;
    export: () => Promise<ApiResult<{ canceled?: boolean; filePath?: string }>>;
    /** V8.1 §40: restart the Pi runtime from Diagnostics. Best-effort. */
    restartRuntime: () => Promise<ApiResult<void>>;
  };
  connections?: ConnectionsChannel;
  health?: HealthChannel;
  evaluation?: EvaluationChannel;
  openExternal?: (url: string) => Promise<ApiResult<void>>;
}

const missingClient = (operation: string) => async () =>
  ({
    ok: false,
    error: { code: 'CLIENT_UNAVAILABLE', message: `${operation} is unavailable in this environment.` },
  } as ApiResult<never>);

export const fallbackClient: FinagentClient = {
  kernel: {
    hydrate: missingClient('kernel.hydrate'),
    createSession: missingClient('kernel.createSession'),
    deleteSession: missingClient('kernel.deleteSession'),
    getMessages: missingClient('kernel.getMessages'),
    listRuns: missingClient('kernel.listRuns'),
    startRun: missingClient('kernel.startRun'),
    cancelRun: missingClient('kernel.cancelRun'),
    onAgentEvent: () => () => undefined,
  },
  agent: {
    getTools: missingClient('agent.getTools'),
  },
  market: {
    getQuote: missingClient('market.getQuote'),
    getKline: missingClient('market.getKline'),
    getPortfolio: missingClient('market.getPortfolio'),
    getStaticInfo: missingClient('market.getStaticInfo'),
    getCalcIndex: missingClient('market.getCalcIndex'),
    getMarketStatus: missingClient('market.getMarketStatus'),
    getNews: missingClient('market.getNews'),
  },
  longbridge: {
    getStatus: missingClient('longbridge.getStatus'),
  },
  about: {
    get: missingClient('about.get'),
  },
  alerts: {
    loadRules: missingClient('alerts.loadRules'),
    saveRules: missingClient('alerts.saveRules'),
    listEvents: missingClient('alerts.listEvents'),
    onTriggered: () => () => undefined,
  },
  capabilities: {
    list: missingClient('capabilities.list'),
  },
  research: {
    start: missingClient('research.start'),
    cancel: missingClient('research.cancel'),
    listRuns: missingClient('research.listRuns'),
    getRun: missingClient('research.getRun'),
    listReports: missingClient('research.listReports'),
    getReport: missingClient('research.getReport'),
    getDiff: missingClient('research.getDiff'),
  },
  screening: {
    run: missingClient('screening.run'),
    listRuns: missingClient('screening.listRuns'),
    getRun: missingClient('screening.getRun'),
  },
  outcome: {
    listOpinions: missingClient('outcome.listOpinions'),
    listOutcomes: missingClient('outcome.listOutcomes'),
    evaluateDue: missingClient('outcome.evaluateDue'),
  },
  thesis: {
    list: missingClient('thesis.list'),
    getReport: missingClient('thesis.getReport'),
    saveFromReport: missingClient('thesis.saveFromReport'),
    reEvaluate: missingClient('thesis.reEvaluate'),
    update: missingClient('thesis.update'),
    listImpacts: missingClient('thesis.listImpacts'),
    onImpact: () => () => undefined,
  },
  compare: {
    build: missingClient('compare.build'),
  },
  portfolioRisk: {
    analyze: missingClient('portfolioRisk.analyze'),
  },
  llm: {
    getState: missingClient('llm.getState'),
    listModels: missingClient('llm.listModels'),
    setModel: missingClient('llm.setModel'),
    listThinkingLevels: missingClient('llm.listThinkingLevels'),
    setThinkingLevel: missingClient('llm.setThinkingLevel'),
    getProviders: missingClient('llm.getProviders'),
    listCredentials: missingClient('llm.listCredentials'),
    setCredential: missingClient('llm.setCredential'),
    removeCredential: missingClient('llm.removeCredential'),
    setCustomProvider: missingClient('llm.setCustomProvider'),
    removeCustomProvider: missingClient('llm.removeCustomProvider'),
    testProvider: missingClient('llm.testProvider'),
  },
  skills: {
    list: missingClient('skills.list'),
    setEnabled: missingClient('skills.setEnabled'),
    listResources: missingClient('skills.listResources'),
    readResource: missingClient('skills.readResource'),
    readiness: missingClient('skills.readiness'),
    installLocal: missingClient('skills.installLocal'),
    remove: missingClient('skills.remove'),
  },
  connections: {
    list: missingClient('connections.list'),
    connect: missingClient('connections.connect'),
    cancelConnect: missingClient('connections.cancelConnect'),
    disconnect: missingClient('connections.disconnect'),
    test: missingClient('connections.test'),
    setConfig: missingClient('connections.setConfig'),
    coverage: missingClient('connections.coverage'),
    onChanged: () => () => undefined,
  },
  health: {
    check: missingClient('health.check'),
  },
  evaluation: {
    getSettings: missingClient('evaluation.getSettings'),
    setSettings: missingClient('evaluation.setSettings'),
    setCredential: missingClient('evaluation.setCredential'),
    removeCredential: missingClient('evaluation.removeCredential'),
    testConnection: missingClient('evaluation.testConnection'),
    listExperiments: missingClient('evaluation.listExperiments'),
    getExperiment: missingClient('evaluation.getExperiment'),
    getCase: missingClient('evaluation.getCase'),
    listBaselines: missingClient('evaluation.listBaselines'),
    submitFeedback: missingClient('evaluation.submitFeedback'),
    listFeedback: missingClient('evaluation.listFeedback'),
    getTraceLink: missingClient('evaluation.getTraceLink'),
    status: missingClient('evaluation.status'),
  },
  prefs: {
    get: async () => ({
      ok: true,
      data: {
        preference: 'system',
        systemLocale: typeof navigator !== 'undefined' ? navigator.language : 'en-US',
        effectiveLocale: 'en-US',
      } as AppPreferencesSnapshot,
    }),
    update: async (locale: LocalePreference) => ({
      ok: true,
      data: {
        preference: locale,
        systemLocale: typeof navigator !== 'undefined' ? navigator.language : 'en-US',
        effectiveLocale: 'en-US',
      } as AppPreferencesSnapshot,
    }),
  },
};

const FinagentClientContext = createContext<FinagentClient>(fallbackClient);

export function FinagentClientProvider({
  client,
  children,
}: {
  client: FinagentClient;
  children: React.ReactNode;
}) {
  return (
    <FinagentClientContext.Provider value={client}>
      {children}
    </FinagentClientContext.Provider>
  );
}

export function useFinagentClient(): FinagentClient {
  return useContext(FinagentClientContext);
}

export type { Skill } from '@finagent/core';
