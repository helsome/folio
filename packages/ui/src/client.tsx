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
  InvestmentThesis,
  Kline,
  KlineRequest,
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
}

export interface SkillResourceItem {
  skillId: string;
  path: string;
  kind: 'skill' | 'reference' | 'script' | 'asset' | 'other';
  size?: number;
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
  };
  diagnostics?: {
    collect: () => Promise<ApiResult<DiagnosticsBundle>>;
    export: () => Promise<ApiResult<{ canceled?: boolean; filePath?: string }>>;
  };
  connections?: ConnectionsChannel;
  health?: HealthChannel;
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
