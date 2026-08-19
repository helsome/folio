import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { app, Notification, shell, type BrowserWindow } from 'electron';
import type {
  AgentEvent,
  AlertRule,
  AlertTriggerEvent,
  ApiResult,
  CapabilityRegistry,
  Comparison,
  CredentialInfo,
  CustomProviderConfig,
  FinancialProviderStatus,
  InvestmentThesis,
  LlmModel,
  LlmRuntimeState,
  LlmTestResult,
  Message,
  PortfolioRiskReport,
  ProviderCoverage,
  ProviderHealth,
  ProviderStatus,
  ResearchReport,
  ResearchRunSummary,
  ResearchSynthesis,
  ResearchSynthesisInput,
  Run,
  ScreeningRun,
  ScreeningQuery,
  ScreeningStrategy,
  ResearchDiff,
  ResearchOpinion,
  ResearchOutcome,
  PortfolioImportDraft,
  PortfolioImportRow,
  ManualPortfolio,
  ImportSource,
  Holding,
  Kline,
  AutomationRule,
  AutomationRun,
  NotificationEvent,
  SkillPerformance,
  StrategyPerformance,
  SkillCalibration,
  StrategyCalibration,
  PortfolioSnapshot,
  SessionMeta,
  SkillReadiness,
  ThesisImpact,
  ThesisImpactInput,
  ToolDefinition,
  WorkspaceContext,
  StrategyId,
  AgentEventPayload,
  ApiError,
  AppPreferencesSnapshot,
  SupportedLocale,
  EvaluationBaseline,
  EvaluationCase,
  EvaluationExperiment,
  EvaluationResultRecord,
  EvaluationRun,
  EvaluationRunStatus,
  EvaluationSettings,
  LangSmithConnectionStatus,
  PrivacyLevel,
  ToolCall,
  ToolCallRecord,
} from '@finagent/core';
import { STRATEGY_IDS } from '@finagent/core';
import { isLocalePreference } from '@finagent/i18n';
import { createAppPreferencesService, type AppPreferencesService } from './app-preferences.ts';
import {
  AgentKernel,
  AlertEngine,
  AlertEventLog,
  AlertRuleRepository,
  buildComparison,
  CapabilityExecutor,
  computeSkillReadiness,
  createAgentEvaluator,
  createAgentSynthesizer,
  createFullRegistry,
  createLocalThesisEvaluator,
  createRouterFetchers,
  ConnectionStore,
  defaultPortfolioRiskSynthesizer,
  FinanceToolRegistry,
  JsonFileStore,
  LocalResearchSynthesizer,
  MarketDataService,
  MassiveFinancialDataProvider,
  parseImpactJson,
  parseSynthesisJson,
  PortfolioRiskService,
  ProviderRouter,
  ResearchReportRepository,
  ResearchService,
  ThesisImpactRepository,
  ThesisRepository,
  ThesisService,
  type AnyProvider,
  type PortfolioRiskSynthesisInput,
  OutcomeRepository,
  OutcomeService,
  PulseService,
  PerformanceService,
  AutomationRuleRepository,
  AutomationRunRepository,
  ScreeningService,
  ScreeningRunRepository,
  SCREENING_STRATEGIES,
  ResearchDiffRepository,
  ManualPortfolioRepository,
  buildDiff,
  buildBrief,
  runAutomation,
  runDue,
  DEFAULT_BRIEF_HOUR,
  THESIS_REVIEW_DAY,
  THESIS_REVIEW_HOUR,
  WEEKDAYS,
  createDraft,
  parseCsv,
  parsePaste,
  reportToMarkdown,
  reportToShareCard,
  redactForShare,
  computeSkillCalibrations,
  computeStrategyCalibrations,
  EvaluationStore,
  TraceCorrelationService,
  resolveBackend,
  EvaluationRedactor,
  PiRuntimeAdapter,
  sanitizeSettings,
  embeddedDatasets,
  isRecord,
  type EvaluationBackend,
  type EvaluationBackendKind,
  type HistoryFetcher,
  type HumanFeedback,
  type DailyBrief,
  type BriefPortfolioSummary,
  type MarketPulseSnapshot,
  type ShareCard,
  type WatchlistQuote,
} from '@finagent/shared';
import {
  LongbridgeBrokerAccountProvider,
  LongbridgeFinancialDataProvider,
  logout as longbridgeLogout,
  startLogin,
  testConnection as longbridgeTestConnection,
  type LongbridgeExec,
  type SpawnFn,
} from '@finagent/shared/providers/longbridge';
import { SkillHub, skillCapabilityMap } from '@finagent/skill-hub';
import {
  getPiCwd,
  getPiExtensionEntry,
  getLangSmithExtensionEntry,
  getRuntimeRoot,
  getSkillsDir,
  listBundledPiExtensions,
} from '@finagent/shared/resources';
import {
  collectDiagnostics,
  ErrorLog,
  type DiagnosticsBundle,
  type FinancialProviderSummary,
} from '@finagent/shared/diagnostics';
import { CredentialStore, redactSecrets } from './credentialStore.ts';
import { executeLongBridge } from '@finagent/longbridge-tools';

/** Renderer-facing mirror of the Connections IPC contract (ui/client/connections.ts). */
interface ConnectionEntry {
  providerId: string;
  kind: 'financial-data' | 'broker-account';
  name: string;
  status: FinancialProviderStatus;
  health: ProviderHealth | null;
  coverage: ProviderCoverage | null;
  configurable: boolean;
  configured: boolean;
  hasAccount: boolean;
  accountLabel: string | null;
  error: { code: string; message: string } | null;
}

type IpcSuccess<T> = { ok: true; data: T };

type IpcFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
    action?: string;
  };
};

export type IpcResult<T> = IpcSuccess<T> | IpcFailure;

interface KlineRequest {
  symbol: string;
  period?: '1m' | '5m' | '15m' | '1h' | '1d' | '1w';
  limit?: number;
}

interface StartRunRequest {
  sessionId: string;
  content: string;
  workspaceContext?: WorkspaceContext;
}

/** Experiment id for runs observed outside explicit evaluation experiments. */
const OBSERVABILITY_EXPERIMENT_ID = '__observability__';

interface PendingEvalRun {
  sessionId: string;
  startedAt: number;
  toolCalls: ToolCall[];
  answer: string;
  error?: ApiError;
}

/**
 * Main-process bridge between the renderer and the agent kernel.
 *
 * Sessions, runs, and agent events live in the kernel; the window only sees
 * the whitelisted IPC surface and the `agent:event` push channel. LLM control
 * and credentials are routed through here as well — secrets never leave the
 * main process.
 */
export class AgentKernelHost {
  private readonly marketData = new MarketDataService();
  private readonly kernel: AgentKernel;
  private readonly credentials: CredentialStore;
  private readonly skillHub: SkillHub;
  /** Full Folio V3 capability registry: agent tools + UI + product workflows. */
  private readonly registry: CapabilityRegistry;
  private readonly executor: CapabilityExecutor;
  private readonly researchService: ResearchService;
  private readonly outcomeRepository: OutcomeRepository;
  private readonly outcomeService: OutcomeService;
  private readonly screeningService: ScreeningService;
  private readonly diffRepository: ResearchDiffRepository;
  private readonly importRepository: ManualPortfolioRepository;
  private readonly pulseService: PulseService;
  private readonly performanceService: PerformanceService;
  private readonly automationRules: AutomationRuleRepository;
  private readonly automationRuns: AutomationRunRepository;
  private automationTimer: ReturnType<typeof setInterval> | null = null;
  private readonly lastAutomationRunByRule = new Map<string, string>();
  private readonly thesisRepository: ThesisRepository;
  private readonly thesisService: ThesisService;
  private readonly alertRepository: AlertRuleRepository;
  private readonly alertEventLog: AlertEventLog;
  private readonly alertEngine: AlertEngine;
  private readonly portfolioRisk: PortfolioRiskService;
  private readonly connectionStore: ConnectionStore;
  private readonly providerRouter: ProviderRouter;
  private activeLogin: { cancel: () => void } | null = null;
  private unsubscribe: (() => void) | null = null;
  private connectionsUnsubscribe: (() => void) | null = null;
  private window: BrowserWindow | null = null;

  // V7 evaluation & observability (spec §15, §52-55, §62-63).
  private readonly evaluationStore: EvaluationStore;

  /** V8: main-owned locale preference (independent of any single store). */
  private readonly appPreferences: AppPreferencesService;
  private evaluationSettings: EvaluationSettings;
  private evaluationBackend: EvaluationBackend;
  private evaluationRedactor: EvaluationRedactor;
  private traceCorrelation: TraceCorrelationService;
  private readonly evalRuns = new Map<string, PendingEvalRun>();
  private unsubscribeEval: (() => void) | null = null;

  constructor() {
    // Resource paths come from ResourceLocator: the repo root in dev, the app
    // Resources dir when packaged. The Pi runtime resolves its extension path
    // relative to the spawn cwd (getPiCwd), so both are wired through it.
    // FINAGENT_PI_EXTENSION lets readDefaultPiArgs() supply the correct
    // --extension without duplicating the default arg list.
    process.env.FINAGENT_PI_EXTENSION = getPiExtensionEntry();
    this.credentials = new CredentialStore(join(app.getPath('userData'), 'credentials.json'));
    this.skillHub = new SkillHub({
      skillsDirectory: getSkillsDir(),
      stateFile: join(app.getPath('userData'), 'skills-state.json'),
    });

    const provider = readAgentProvider();
    const userData = app.getPath('userData');

    // V8: main-owned app preferences (locale), resolved against the OS locale.
    this.appPreferences = createAppPreferencesService(new JsonFileStore(userData), () => app.getLocale());

    // V4 provider platform: the capability registry is built on top of the
    // provider router, which owns the Longbridge (primary) and Massive
    // (fallback) adapters. Business layers see only the neutral capability
    // surface — vendor specifics stay inside the adapters.
    this.connectionStore = new ConnectionStore(new JsonFileStore(userData));
    this.providerRouter = new ProviderRouter();
    const longbridgeData = new LongbridgeFinancialDataProvider();
    const longbridgeBroker = new LongbridgeBrokerAccountProvider();
    const massive = new MassiveFinancialDataProvider({
      getApiKey: async () => (await this.connectionStore.getConfig('massive'))?.apiKey,
    });
    this.providerRouter.register(longbridgeData);
    this.providerRouter.register(longbridgeBroker);
    this.providerRouter.register(massive);
    this.providerRouter.setRouting({ primary: 'longbridge', fallback: 'massive' });

    this.registry = createFullRegistry(createRouterFetchers(this.providerRouter));
    this.executor = new CapabilityExecutor();

    this.researchService = new ResearchService({
      registry: this.registry,
      synthesizer:
        provider === 'local'
          ? new LocalResearchSynthesizer()
          : createAgentSynthesizer(this.runResearchSynthesis),
      repository: new ResearchReportRepository(new JsonFileStore(join(userData, 'store'))),
      onReport: (report) => {
        void this.outcomeService.createOpinionFromReport(report);
        void this.saveDiffForReport(report);
      },
    });

    // V5 outcome evaluation: opinions snapshotted from reports, outcomes
    // evaluated when their horizon is reached (spec §29–35).
    this.outcomeRepository = new OutcomeRepository(new JsonFileStore(userData));
    this.outcomeService = new OutcomeService({ repository: this.outcomeRepository });

    // V5 screening + import services (spec §5–10, §43–49).
    this.screeningService = new ScreeningService({
      registry: this.registry,
      executor: this.executor,
      repository: new ScreeningRunRepository(new JsonFileStore(userData)),
    });
    this.diffRepository = new ResearchDiffRepository(new JsonFileStore(userData));
    this.importRepository = new ManualPortfolioRepository(new JsonFileStore(userData));

    // V5 market pulse + performance (spec §50–52, §36–38).
    this.pulseService = new PulseService({
      registry: this.registry,
      screening: this.screeningService,
      executor: this.executor,
    });
    this.performanceService = new PerformanceService(this.outcomeRepository);

    // V5 scheduled research (spec §21–25): five default rules, seeded once.
    this.automationRules = new AutomationRuleRepository(new JsonFileStore(userData));
    this.automationRuns = new AutomationRunRepository(new JsonFileStore(userData));
    void this.seedAutomationRules();

    this.thesisRepository = new ThesisRepository({ storageDir: join(userData, 'thesis') });
    this.thesisService = new ThesisService({
      registry: this.registry,
      repository: this.thesisRepository,
      impactRepository: new ThesisImpactRepository({ storageDir: join(userData, 'thesis') }),
      evaluator:
        provider === 'local'
          ? createLocalThesisEvaluator()
          : createAgentEvaluator(this.runThesisImpact),
    });

    const alertsStore = new JsonFileStore(userData);
    this.alertRepository = new AlertRuleRepository(alertsStore);
    this.alertEventLog = new AlertEventLog(alertsStore);
    this.alertEngine = new AlertEngine({
      registry: this.registry,
      repository: this.alertRepository,
      eventLog: this.alertEventLog,
      onTrigger: (event) => void this.handleAlertTrigger(event),
    });

    this.portfolioRisk = new PortfolioRiskService({
      registry: this.registry,
      executor: this.executor,
      synthesizer: provider === 'local' ? defaultPortfolioRiskSynthesizer : this.runRiskSummary,
    });

    this.kernel = new AgentKernel({
      storageDir: join(userData, 'store'),
      piSessionDir: join(userData, 'pi-sessions'),
      provider,
      marketData: this.marketData,
      registry: new FinanceToolRegistry(this.registry),
      skillHub: this.skillHub,
      rpc: {
        cwd: getPiCwd(),
        requiredEnvKeys: readRequiredLlmEnvKeys(),
        env: () => this.buildRuntimeEnv(),
      },
    });

    // V7 evaluation & observability: settings load synchronously so the Pi
    // extension list is correct before the first runtime spawn; tracing is
    // off by default (spec §11, §58).
    this.evaluationStore = new EvaluationStore(new JsonFileStore(userData));
    this.evaluationSettings = this.evaluationStore.getSettingsSync();
    this.evaluationBackend = resolveBackend(this.evaluationSettings, undefined);
    this.evaluationRedactor = new EvaluationRedactor(this.evaluationSettings.privacyLevel);
    this.traceCorrelation = new TraceCorrelationService({
      backend: this.evaluationBackend,
      store: this.evaluationStore,
    });
    this.applyRuntimeExtensions();
    this.unsubscribeEval = this.kernel.runs.subscribe((event) => void this.observeRunEvent(event));
    void this.refreshEvaluationBackend();
    void this.skillHub.loadSkills();
    this.alertEngine.start();
    void this.outcomeService.evaluateDue(undefined, this.fetchOutcomeHistory);
    this.startAutomationScheduler();
  }

  /** Forward kernel events to the window's renderer. */
  attach(window: BrowserWindow): void {
    this.window = window;
    this.unsubscribe?.();
    this.unsubscribe = this.kernel.runs.subscribe((event: AgentEvent) => {
      if (!window.isDestroyed()) {
        window.webContents.send('agent:event', event);
      }
    });
    this.connectionsUnsubscribe?.();
    this.connectionsUnsubscribe = this.connectionStore.subscribe(() => {
      void this.pushConnections();
    });
  }

  async hydrate(): Promise<{ sessions: SessionMeta[] }> {
    return { sessions: await this.kernel.sessions.listSessions() };
  }

  async createSession(title: unknown): Promise<SessionMeta> {
    return this.kernel.sessions.createSession(typeof title === 'string' ? title : undefined);
  }

  async deleteSession(sessionId: unknown): Promise<void> {
    await this.kernel.deleteSession(requireString(sessionId, 'sessionId'));
  }

  async getMessages(sessionId: unknown): Promise<Message[]> {
    return this.kernel.sessions.listMessages(requireString(sessionId, 'sessionId'));
  }

  async listRuns(sessionId: unknown): Promise<Run[]> {
    return this.kernel.sessions.listRuns(requireString(sessionId, 'sessionId'));
  }

  async startRun(input: unknown): Promise<Run> {
    const request = requireObject(input) as Partial<StartRunRequest>;
    let workspaceContext: WorkspaceContext | undefined;
    if (request.workspaceContext && typeof request.workspaceContext === 'object') {
      const context = request.workspaceContext as Record<string, unknown>;
      workspaceContext = {};
      if (typeof context.activeSymbol === 'string') {
        workspaceContext.activeSymbol = context.activeSymbol.toUpperCase();
      }
      if (
        context.activeView === 'overview' ||
        context.activeView === 'chart' ||
        context.activeView === 'financials' ||
        context.activeView === 'news' ||
        context.activeView === 'portfolio'
      ) {
        workspaceContext.activeView = context.activeView;
      }
      if (typeof context.selectedPosition === 'string') {
        workspaceContext.selectedPosition = context.selectedPosition;
      }
      if (
        Array.isArray(context.comparisonSymbols) &&
        context.comparisonSymbols.every((entry) => typeof entry === 'string')
      ) {
        workspaceContext.comparisonSymbols = context.comparisonSymbols.map((entry) =>
          entry.toUpperCase()
        );
      }
    }
    // V8: new agent responses follow the *effective* app locale unless the
    // user explicitly requests another language in the prompt (spec §41–42).
    // Resolved after validation and with a safe fallback so a prefs failure
    // can never block an agent run (failure-isolation, spec §87).
    return this.kernel.runs.startRun(
      requireString(request.sessionId, 'sessionId'),
      requireString(request.content, 'content'),
      workspaceContext,
      await this.effectiveRunLocale()
    );
  }

  private async effectiveRunLocale(): Promise<SupportedLocale> {
    try {
      return (await this.getAppPreferences()).effectiveLocale;
    } catch {
      return 'en-US';
    }
  }

  async cancelRun(input: unknown): Promise<void> {
    const request = requireObject(input);
    await this.kernel.runs.cancelRun(
      requireString(request.sessionId, 'sessionId'),
      requireString(request.runId, 'runId')
    );
  }

  getTools(): Promise<ApiResult<ToolDefinition[]>> {
    return this.kernel.getTools();
  }

  getQuote(symbol: unknown) {
    return this.marketData.getQuote(requireString(symbol, 'symbol').toUpperCase());
  }

  getKline(input: unknown) {
    const request = requireObject(input);
    const payload: KlineRequest = {
      symbol: requireString(request.symbol, 'symbol').toUpperCase(),
    };

    if (typeof request.period === 'string') {
      payload.period = request.period as KlineRequest['period'];
    }

    if (typeof request.limit === 'number' && Number.isFinite(request.limit)) {
      payload.limit = request.limit;
    }

    return this.marketData.getKline({
      symbol: payload.symbol,
      period: payload.period,
      limit: payload.limit,
    });
  }

  getPortfolio() {
    return this.marketData.getPortfolio();
  }

  getStaticInfo(symbol: unknown) {
    return this.marketData.getStaticInfo(requireString(symbol, 'symbol').toUpperCase());
  }

  getCalcIndex(symbol: unknown) {
    return this.marketData.getCalcIndex(requireString(symbol, 'symbol').toUpperCase());
  }

  getMarketStatus() {
    return this.marketData.getMarketStatus();
  }

  getNews(symbol: unknown) {
    return this.marketData.getNews(requireString(symbol, 'symbol').toUpperCase());
  }

  async getLongBridgeStatus() {
    const status = await this.marketData.getLongBridgeStatus();
    const message = status.available
      ? 'LongBridge CLI is installed and authenticated.'
      : status.error?.message ?? 'LongBridge CLI is not ready.';
    const action = status.available
      ? undefined
      : getLongBridgeStatusAction(status.status);

    return {
      ...status,
      authenticated: status.authed,
      message,
      action,
      code: status.error?.code,
    };
  }

  // -------------------------------------------------------------------------
  // Folio V3: capabilities, research, thesis, compare, alerts, portfolio risk
  // -------------------------------------------------------------------------

  /** Capability metadata for UI availability (schemas never cross IPC). */
  listCapabilities() {
    return this.registry.list().map((cap) => ({
      id: cap.id,
      name: cap.name,
      description: cap.description,
      category: cap.category,
      riskLevel: cap.riskLevel,
      auth: cap.auth,
      toolName: cap.toolName,
    }));
  }

  /** Skill readiness: capability requirements × registry coverage. */
  listSkillReadiness(): SkillReadiness[] {
    const readiness: SkillReadiness[] = [];
    for (const skillId of Object.keys(skillCapabilityMap)) {
      const requirements = skillCapabilityMap[skillId];
      if (!requirements) continue;
      readiness.push(computeSkillReadiness(skillId, requirements, this.registry));
    }
    return readiness;
  }

  // -- Deep Research ---------------------------------------------------------

  async researchStart(input: unknown): Promise<ResearchRunSummary> {
    const request = requireObject(input);
    const symbol = requireString(request.symbol, 'symbol').toUpperCase();
    const strategyId =
      typeof request.strategyId === 'string' &&
      (STRATEGY_IDS as readonly string[]).includes(request.strategyId)
        ? (request.strategyId as StrategyId)
        : undefined;
    return this.researchService.start(symbol, strategyId, await this.effectiveRunLocale());
  }

  async researchCancel(input: unknown): Promise<void> {
    const request = requireObject(input);
    await this.researchService.cancel(requireString(request.runId, 'runId'));
  }

  async researchListRuns(): Promise<ResearchRunSummary[]> {
    return this.researchService.listRuns();
  }

  async researchGetRun(input: unknown): Promise<ResearchRunSummary | undefined> {
    const request = requireObject(input);
    return this.researchService.getRun(requireString(request.runId, 'runId'));
  }

  async researchListReports(input: unknown): Promise<ResearchReport[]> {
    const request = requireObject(input);
    const symbol =
      typeof request.symbol === 'string' && request.symbol.length > 0
        ? request.symbol.toUpperCase()
        : undefined;
    return this.researchService.listReports(symbol);
  }

  async researchGetReport(input: unknown): Promise<ResearchReport | undefined> {
    const request = requireObject(input);
    return this.researchService.getReport(requireString(request.reportId, 'reportId'));
  }

  // -- Investment Thesis -----------------------------------------------------

  async thesisList(symbol?: unknown): Promise<InvestmentThesis[]> {
    if (typeof symbol === 'string' && symbol.length > 0) {
      return this.thesisRepository.getBySymbol(symbol.toUpperCase());
    }
    return this.thesisRepository.list();
  }

  /** Latest research report for a symbol (used by "Save as Thesis"). */
  async thesisGetReport(symbol: unknown): Promise<ResearchReport | null> {
    const reports = await this.researchService.listReports(
      requireString(symbol, 'symbol').toUpperCase()
    );
    return reports[0] ?? null;
  }

  async thesisSaveFromReport(symbol: unknown): Promise<InvestmentThesis> {
    const report = await this.thesisGetReport(symbol);
    if (!report) {
      throw createCodeError(
        'REPORT_NOT_FOUND',
        'No research report for this symbol. Run Deep Research first.'
      );
    }
    return this.thesisService.saveFromReport(report);
  }

  async thesisReEvaluate(symbol: unknown): Promise<ThesisImpact> {
    return this.thesisService.reEvaluate(requireString(symbol, 'symbol').toUpperCase());
  }

  async thesisUpdate(input: unknown): Promise<InvestmentThesis> {
    const request = requireObject(input);
    return this.thesisService.updateThesis(request as unknown as InvestmentThesis);
  }

  async thesisListImpacts(symbol: unknown): Promise<ThesisImpact[]> {
    return this.thesisService.listImpacts(requireString(symbol, 'symbol').toUpperCase());
  }

  // -- Compare ---------------------------------------------------------------

  async compareBuild(input: unknown): Promise<Comparison> {
    const request = requireObject(input);
    if (!Array.isArray(request.symbols) || request.symbols.length < 2) {
      throw createCodeError('INVALID_ARGUMENT', 'Compare needs at least two symbols.');
    }
    const symbols = request.symbols.map((entry) =>
      requireString(entry, 'symbols[]').toUpperCase()
    );
    return buildComparison(symbols, this.registry, { executor: this.executor });
  }

  // -- Portfolio risk --------------------------------------------------------

  async portfolioRiskAnalyze(): Promise<PortfolioRiskReport> {
    return this.portfolioRisk.analyze();
  }

  // -- Alerts (v2 engine) ----------------------------------------------------

  async loadAlertRules(): Promise<AlertRule[]> {
    return this.alertRepository.list();
  }

  async saveAlertRules(input: unknown): Promise<void> {
    if (!Array.isArray(input)) {
      throw createCodeError('INVALID_ARGUMENT', 'Expected an array of alert rules.');
    }
    const incoming = input as AlertRule[];
    const existing = await this.alertRepository.list();
    const incomingIds = new Set(incoming.map((rule) => rule.id));
    for (const rule of incoming) {
      await this.alertRepository.save(rule);
    }
    for (const stale of existing) {
      if (!incomingIds.has(stale.id)) {
        await this.alertRepository.remove(stale.id);
      }
    }
  }

  async listAlertEvents(): Promise<AlertTriggerEvent[]> {
    return this.alertEventLog.list();
  }

  // -- Agent-backed V3 runners ----------------------------------------------

  /**
   * Run one prompt through the agent kernel and resolve the final answer.
   * Creates a throwaway session; the run settles via the event stream.
   */
  private async runAgentPrompt(content: string, signal?: AbortSignal): Promise<string> {
    // Keep synthesis runs out of the user's copilot history. The run still
    // uses the normal kernel/runtime contract, but its session is internal.
    const session = await this.kernel.sessions.createSession('__folio_internal_research__');
    try {
      const answer = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(createCodeError('SYNTHESIS_TIMEOUT', 'Agent synthesis timed out.')),
          240_000
        );
        const abort = () => reject(createCodeError('SYNTHESIS_CANCELLED', 'Synthesis cancelled.'));
        signal?.addEventListener('abort', abort, { once: true });
        const unsubscribe = this.kernel.runs.subscribe((event: AgentEvent) => {
          if (event.sessionId !== session.id) return;
          if (event.type === 'run_completed') {
            cleanup();
            resolve(event.payload.answer);
          } else if (event.type === 'run_failed') {
            cleanup();
            reject(createCodeError(event.payload.error.code, event.payload.error.message));
          }
        });
        const cleanup = () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
          unsubscribe();
        };
      });
      await this.kernel.runs.startRun(session.id, content);
      return await answer;
    } finally {
      await this.kernel.deleteSession(session.id).catch(() => undefined);
    }
  }

  private runResearchSynthesis = async (
    input: ResearchSynthesisInput,
    signal?: AbortSignal
  ): Promise<ResearchSynthesis> => {
    const answer = await this.runAgentPrompt(buildSynthesisPrompt(input), signal);
    return parseSynthesisJson(answer);
  };

  private runThesisImpact = async (
    input: ThesisImpactInput,
    signal?: AbortSignal
  ): Promise<{ kind: ThesisImpact['kind']; summary: string; updatedThesis: InvestmentThesis }> => {
    const answer = await this.runAgentPrompt(buildImpactPrompt(input), signal);
    return parseImpactJson(answer);
  };

  private runRiskSummary = async (
    input: PortfolioRiskSynthesisInput,
    signal?: AbortSignal
  ): Promise<string> => {
    const answer = await this.runAgentPrompt(buildRiskSummaryPrompt(input), signal);
    return answer.trim();
  };

  /** OS notification + renderer push + thesis-impact hook for alert triggers. */
  private async handleAlertTrigger(event: AlertTriggerEvent): Promise<void> {
    this.window?.webContents.send('alerts:triggered', event);
    if (Notification.isSupported()) {
      new Notification({
        title: `Folio — ${event.title}`,
        body: event.message,
      }).show();
    }
    if (!event.symbol) return;
    const theses = await this.thesisRepository.getBySymbol(event.symbol);
    if (theses.length === 0) return;
    try {
      const impact = await this.thesisService.reEvaluate(event.symbol, {
        ruleId: event.ruleId,
        ruleType: event.ruleType,
        eventId: event.id,
      });
      this.window?.webContents.send('thesis:impact', impact);
    } catch (error) {
      // An alert must never crash the engine tick; the trigger is already logged.
      console.error('thesis impact evaluation failed:', error);
    }
  }

  // -------------------------------------------------------------------------
  // LLM control plane
  // -------------------------------------------------------------------------

  private requireLlm() {
    const api = this.kernel.getLlmApi();
    if (!api) {
      throw createCodeError(
        'LLM_UNAVAILABLE',
        'The LLM control plane is only available with the Pi runtime. Set FINAGENT_AGENT_PROVIDER=pi-runtime.'
      );
    }
    return api;
  }

  getLlmState(): Promise<LlmRuntimeState> {
    return this.requireLlm().getState();
  }

  listModels(): Promise<LlmModel[]> {
    return this.requireLlm().listModels();
  }

  async setModel(input: unknown): Promise<LlmRuntimeState> {
    const request = requireObject(input);
    return this.requireLlm().setModel(
      requireString(request.provider, 'provider'),
      requireString(request.modelId, 'modelId')
    );
  }

  listThinkingLevels(): Promise<string[]> {
    return this.requireLlm().listThinkingLevels();
  }

  async setThinkingLevel(input: unknown): Promise<LlmRuntimeState> {
    const request = requireObject(input);
    return this.requireLlm().setThinkingLevel(requireString(request.level, 'level'));
  }

  /**
   * Provider status: merges the runtime model registry with the credential
   * store. `connected` = models listed AND credential present (or no key
   * required); `missing_credential` = provider known by the runtime but no
   * key stored; `unavailable` = not in the registry.
   */
  async getProviders(): Promise<ProviderStatus[]> {
    let models: LlmModel[] = [];
    let runtimeError: string | undefined;
    try {
      models = await this.requireLlm().listModels();
    } catch (error) {
      runtimeError = error instanceof Error ? error.message : String(error);
    }

    const credentialInfos = await this.credentials.listCredentials();
    const byProvider = new Map<string, LlmModel[]>();
    for (const model of models) {
      const list = byProvider.get(model.provider) ?? [];
      list.push(model);
      byProvider.set(model.provider, list);
    }

    const statuses: ProviderStatus[] = [];
    for (const [provider, providerModels] of byProvider) {
      const credential = credentialInfos.find((info) => info.provider === provider);
      statuses.push({
        provider,
        displayName: providerModels[0]?.name ? provider : provider,
        status: credential?.configured ? 'connected' : 'missing_credential',
        modelCount: providerModels.length,
        message: credential?.configured
          ? undefined
          : 'No API key stored. Add one in Settings → Models.',
      });
    }
    for (const info of credentialInfos) {
      if (info.custom || byProvider.has(info.provider)) continue;
      statuses.push({
        provider: info.provider,
        displayName: info.provider,
        status: 'missing_credential',
        message: 'Provider is configured but not present in the runtime registry.',
      });
    }
    if (runtimeError) {
      statuses.push({
        provider: 'runtime',
        displayName: 'Pi Runtime',
        status: 'runtime_error',
        message: runtimeError,
      });
    }
    return statuses;
  }

  async listCredentials(): Promise<CredentialInfo[]> {
    return this.credentials.listCredentials();
  }

  async setCredential(input: unknown): Promise<void> {
    const request = requireObject(input);
    const provider = requireString(request.provider, 'provider');
    const apiKey = requireString(request.apiKey, 'apiKey');
    await this.credentials.setCredential(provider, apiKey);
    // The extension registers providers at Pi startup — respawn to pick up.
    await this.requireLlm().restart();
  }

  async removeCredential(input: unknown): Promise<void> {
    const request = requireObject(input);
    await this.credentials.removeCredential(requireString(request.provider, 'provider'));
    await this.requireLlm().restart();
  }

  async setCustomProvider(input: unknown): Promise<void> {
    const request = requireObject(input) as unknown as CustomProviderConfig;
    const config: CustomProviderConfig = {
      name: requireString(request.name, 'name'),
      displayName: requireString(request.displayName, 'displayName'),
      baseUrl: requireString(request.baseUrl, 'baseUrl'),
      api: typeof request.api === 'string' ? request.api : 'openai-completions',
      apiKey: typeof request.apiKey === 'string' ? request.apiKey : undefined,
      models: Array.isArray(request.models) ? request.models : [],
    };
    if (config.models.length === 0) {
      throw createCodeError('INVALID_ARGUMENT', 'A custom provider needs at least one model.');
    }
    await this.credentials.setCustomProvider(config);
    await this.requireLlm().restart();
  }

  async removeCustomProvider(input: unknown): Promise<void> {
    const request = requireObject(input);
    await this.credentials.removeCustomProvider(requireString(request.name, 'name'));
    await this.requireLlm().restart();
  }

  async testProvider(input: unknown): Promise<LlmTestResult> {
    const request = requireObject(input);
    return this.requireLlm().testProvider(
      requireString(request.provider, 'provider'),
      requireString(request.modelId, 'modelId')
    );
  }
  // -------------------------------------------------------------------------
  // Evaluation & observability (V7 spec §15, §52-63)
  // -------------------------------------------------------------------------

  /** Renderer-safe settings + live connection state (never the API key). */
  async getEvaluationSettings(): Promise<{
    settings: EvaluationSettings;
    connection: LangSmithConnectionStatus;
  }> {
    return { settings: this.evaluationSettings, connection: await this.testEvaluationConnection() };
  }

  async setEvaluationSettings(input: unknown): Promise<EvaluationSettings> {
    const request = requireObject(input);
    const sanitized = sanitizeSettings({ ...this.evaluationSettings, ...request });
    const changed =
      sanitized.tracingEnabled !== this.evaluationSettings.tracingEnabled ||
      sanitized.langsmithProject !== this.evaluationSettings.langsmithProject ||
      sanitized.langsmithEndpoint !== this.evaluationSettings.langsmithEndpoint ||
      sanitized.privacyLevel !== this.evaluationSettings.privacyLevel;
    this.evaluationSettings = sanitized;
    await this.evaluationStore.saveSettings(sanitized);
    if (changed) {
      this.evaluationRedactor = new EvaluationRedactor(sanitized.privacyLevel);
      this.applyRuntimeExtensions();
      await this.refreshEvaluationBackend();
      // Env changes (tracing vars, privacy level) apply at the next Pi spawn.
      if (this.kernel.getLlmApi()) {
        await this.kernel.getLlmApi()!.restart();
      }
    }
    return sanitized;
  }

  /** Store the LangSmith API key via safeStorage; renderer never reads it back. */
  async setEvaluationCredential(input: unknown): Promise<void> {
    const request = requireObject(input);
    const apiKey = requireString(request.apiKey, 'apiKey');
    await this.credentials.setCredential('langsmith', apiKey);
    this.evaluationSettings = { ...this.evaluationSettings, apiKeyConfigured: true, updatedAt: Date.now() };
    await this.evaluationStore.saveSettings(this.evaluationSettings);
    await this.refreshEvaluationBackend();
  }

  async removeEvaluationCredential(): Promise<void> {
    await this.credentials.removeCredential('langsmith');
    this.evaluationSettings = { ...this.evaluationSettings, apiKeyConfigured: false, updatedAt: Date.now() };
    await this.evaluationStore.saveSettings(this.evaluationSettings);
    await this.refreshEvaluationBackend();
  }

  async testEvaluationConnection(): Promise<LangSmithConnectionStatus> {
    const key = await this.credentials.getCredential('langsmith');
    const backend = resolveBackend(this.evaluationSettings, key);
    const status = await backend.status();
    return {
      connected: status.available,
      configured: Boolean(key && this.evaluationSettings.tracingEnabled),
      project: this.evaluationSettings.langsmithProject,
      endpoint: status.endpoint,
      error: status.available ? undefined : status.message,
      message: status.message,
    };
  }

  async listEvaluationExperiments(): Promise<EvaluationExperiment[]> {
    return this.evaluationStore.listExperiments();
  }

  async getEvaluationExperiment(
    input: unknown
  ): Promise<
    | {
        experiment: EvaluationExperiment;
        runs: EvaluationRun[];
        results: EvaluationResultRecord[];
      }
    | undefined
  > {
    const request = requireObject(input);
    const id = requireString(request.id, 'id');
    const experiment = await this.evaluationStore.getExperiment(id);
    if (!experiment) return undefined;
    return {
      experiment,
      runs: await this.evaluationStore.listRuns(id),
      results: await this.evaluationStore.listResults(id),
    };
  }

  async listEvaluationBaselines(): Promise<EvaluationBaseline[]> {
    return this.evaluationStore.listBaselines();
  }

  async submitEvaluationFeedback(input: unknown): Promise<void> {
    const request = requireObject(input);
    const caseId = requireString(request.caseId, 'caseId');
    await this.evaluationStore.addFeedback({
      id: `feedback-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      caseId,
      runId: typeof request.runId === 'string' ? request.runId : undefined,
      verdict: request.verdict === 'bad' ? 'bad' : 'good',
      note: typeof request.note === 'string' ? request.note : undefined,
      createdAt: Date.now(),
    });
  }

  async listEvaluationFeedback(): Promise<HumanFeedback[]> {
    return this.evaluationStore.listFeedback();
  }

  /** Resolve a benchmark case definition for the case-detail view (spec §69). */
  async getEvaluationCase(input: unknown): Promise<EvaluationCase | undefined> {
    const request = requireObject(input);
    const id = requireString(request.id, 'id');
    for (const entry of embeddedDatasets) {
      const found = entry.load().cases.find((case_) => case_.id === id);
      if (found) return found;
    }
    const userDatasets = await this.evaluationStore.listDatasets();
    for (const dataset of userDatasets) {
      const found = dataset.cases.find((case_) => case_.id === id);
      if (found) return found;
    }
    return undefined;
  }

  /** Diagnostics: extension/trace/backend availability without secrets (spec §86). */
  async getEvaluationStatus(): Promise<{
    backend: EvaluationBackendKind;
    tracingEnabled: boolean;
    privacyLevel: PrivacyLevel;
    project: string;
  }> {
    return {
      backend: this.evaluationBackend.kind,
      tracingEnabled: this.evaluationSettings.tracingEnabled,
      privacyLevel: this.evaluationSettings.privacyLevel,
      project: this.evaluationSettings.langsmithProject,
    };
  }

  // -------------------------------------------------------------------------
  // V7 internals
  // -------------------------------------------------------------------------

  /** Keep the runtime extension list in sync with evaluation settings. */
  private applyRuntimeExtensions(): void {
    if (!(this.kernel.runtime instanceof PiRuntimeAdapter)) return;
    const extra: string[] = [];
    if (this.evaluationSettings.tracingEnabled) {
      extra.push(getLangSmithExtensionEntry());
    }
    this.kernel.runtime.setExtensions(listBundledPiExtensions(extra));
  }

  /** Reload the LangSmith credential so the backend reflects storage changes. */
  private async refreshEvaluationBackend(): Promise<void> {
    const key = await this.credentials.getCredential('langsmith');
    const backend = resolveBackend(this.evaluationSettings, key);
    this.evaluationBackend = backend;
    this.traceCorrelation = new TraceCorrelationService({
      backend,
      store: this.evaluationStore,
    });
    void backend.status().catch(() => undefined);
  }

  /** Observe run lifecycle events and persist redacted evaluation records. */
  private observeRunEvent(event: AgentEvent): void {
    if (event.type === 'run_started') {
      this.evalRuns.set(event.runId, {
        sessionId: event.sessionId,
        startedAt: event.timestamp,
        toolCalls: [],
        answer: '',
      });
      return;
    }
    const pending = this.evalRuns.get(event.runId);
    if (!pending) return;
    if (event.type === 'tool_started') {
      pending.toolCalls.push(event.payload.toolCall);
    } else if (event.type === 'message_completed') {
      pending.answer = event.payload.answer;
    } else if (event.type === 'run_completed' || event.type === 'run_failed') {
      const completed = event.type === 'run_completed';
      void this.settleEvaluationRun(event.runId, event.sessionId, completed, event.timestamp);
    }
  }

  private async settleEvaluationRun(
    runId: string,
    sessionId: string,
    completed: boolean,
    endedAt: number
  ): Promise<void> {
    const pending = this.evalRuns.get(runId);
    this.evalRuns.delete(runId);
    if (!pending) return;
    const status: EvaluationRunStatus = completed ? 'completed' : 'failed';
    const toolCalls: ToolCallRecord[] = pending.toolCalls.map((toolCall) => ({
      id: toolCall.id,
      toolName: toolCall.toolName,
      args: toolCall.args,
      startedAt: toolCall.startedAt,
      completedAt: toolCall.completedAt,
      status: toolCall.status === 'success' ? 'success' : 'error',
      error: toolCall.error,
      result: toolCall.result,
    }));
    const run: EvaluationRun = {
      id: runId,
      experimentId: OBSERVABILITY_EXPERIMENT_ID,
      caseId: '',
      datasetId: '',
      status,
      startedAt: pending.startedAt,
      completedAt: endedAt,
      latencyMs: Math.max(0, endedAt - pending.startedAt),
      answer: this.evaluationRedactor.redactAnswer(pending.answer),
      toolCalls: toolCalls.map((toolCall) => this.evaluationRedactor.redactToolCall(toolCall)),
      failureModes: [],
      error: pending.error,
    };
    try {
      await this.evaluationStore.addRun(run);
    } catch (error) {
      mainErrorLog.push({
        at: Date.now(),
        source: 'main',
        message: `Evaluation store write failed: ${error instanceof Error ? error.message : String(error)}`,
        stack: null,
      });
    }
    const session = await this.kernel.sessions.getSession(sessionId).catch(() => undefined);
    const threadId = session?.runtimeSessionId;
    const ref = await this.traceCorrelation.recordRun({
      folioRunId: runId,
      folioSessionId: sessionId,
      threadId,
      startedAt: pending.startedAt,
      completedAt: endedAt,
    });
    if (ref.backend === 'none' && this.evaluationSettings.tracingEnabled) {
      mainErrorLog.push({
        at: Date.now(),
        source: 'main',
        message: 'Trace correlation: no LangSmith trace matched the finished run.',
        stack: null,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Diagnostics (spec §35–36)
  // -------------------------------------------------------------------------

  async collectDiagnostics(): Promise<DiagnosticsBundle> {
    let llmState: LlmRuntimeState | null = null;
    try {
      llmState = await this.requireLlm().getState();
    } catch {
      // Local provider (no Pi runtime) — llm fields stay null.
    }
    // V8.1 §40: Pi runtime facts (sanitized). Local backend → all nulls.
    let piDiag = {
      status: 'unknown' as 'idle' | 'running' | 'exited' | 'unknown',
      command: null as string | null,
      cwd: null as string | null,
      extensions: [] as string[],
      providersConfigured: [] as string[],
      model: null as string | null,
      lastExitCode: null as number | null,
      lastExitSignal: null as string | null,
      stderrTail: null as string | null,
      observabilityDegraded: null as boolean | null,
    };
    if (this.kernel.runtime instanceof PiRuntimeAdapter) {
      try {
        piDiag = await this.kernel.runtime.getRuntimeDiagnostics(llmState);
      } catch {
        // Diagnostics must never fail because the runtime object slipped.
      }
    }
    let providerSummaries: FinancialProviderSummary[] = [];
    try {
      providerSummaries = this.listFinancialProviders();
    } catch {
      // Provider wiring lands with the connector slice; empty until then.
    }
    return collectDiagnostics({
      version: app.getVersion(),
      os: process.platform,
      arch: process.arch,
      electronVersion: process.versions.electron ?? null,
      agentProviderId: readAgentProvider(),
      agentState: llmState?.runtimeProvider ?? null,
      llmProviderId: llmState?.model?.provider ?? null,
      llmModel: llmState?.model?.id ?? null,
      financialProviders: providerSummaries,
      brokerConnected: providerSummaries.some((p) => p.id === 'longbridge-broker'),
      brokerAccountCount: providerSummaries.some((p) => p.id === 'longbridge-broker') ? 1 : 0,
      skillsLoadedCount: this.skillHub.listSkills().length,
      capabilities: this.registry,
      resources: { dev: !app.isPackaged, root: getRuntimeRoot() },
      evaluation: {
        backend: this.evaluationBackend.kind,
        tracingEnabled: this.evaluationSettings.tracingEnabled,
        privacyLevel: this.evaluationSettings.privacyLevel,
        project: this.evaluationSettings.langsmithProject,
        // Connection liveness is probed on demand (testEvaluationConnection);
        // the bundle only records configured/disabled state (spec §86).
        connected: null,
        traceStatus: this.evaluationSettings.tracingEnabled ? 'configured' : 'disabled',
        datasets: this.evaluationStore
          ? await this.listEvaluationDatasetIds()
          : [],
      },
      errors: mainErrorLog.recent(20),
      pi: {
        status: piDiag.status,
        command: piDiag.command,
        cwd: piDiag.cwd,
        extensions: piDiag.extensions,
        providersConfigured: piDiag.providersConfigured,
        model: piDiag.model,
        lastExitCode: piDiag.lastExitCode,
        lastExitSignal: piDiag.lastExitSignal,
        stderrTail: piDiag.stderrTail,
        observabilityDegraded: piDiag.observabilityDegraded,
      },
    });
  }

  /** V8.1 §40: restart the Pi runtime from Diagnostics. Best-effort. */
  async restartRuntime(): Promise<void> {
    if (!(this.kernel.runtime instanceof PiRuntimeAdapter)) return;
    await this.kernel.runtime.restart();
  }

  /** Embedded + user dataset ids for diagnostics (spec §86). */
  private async listEvaluationDatasetIds(): Promise<string[]> {
    const ids: string[] = [];
    for (const entry of embeddedDatasets) {
      try {
        ids.push(entry.load().id);
      } catch {
        // A broken embedded dataset must not break diagnostics.
      }
    }
    try {
      const user = await this.evaluationStore.listDatasets();
      ids.push(...user.map((dataset) => dataset.id));
    } catch {
      // Store failures are already logged elsewhere.
    }
    return [...new Set(ids)];
  }

  // -------------------------------------------------------------------------
  // Environment health check (onboarding step 4, spec §30)
  // -------------------------------------------------------------------------

  async checkHealth(): Promise<{
    ai: { ok: boolean; detail: string | null; error: { code: string; message: string } | null };
    marketData: { ok: boolean; detail: string | null; error: { code: string; message: string } | null };
    skills: { ok: boolean; detail: string | null; error: { code: string; message: string } | null };
    agentRuntime: { ok: boolean; detail: string | null; error: { code: string; message: string } | null };
  }> {
    const item = (ok: boolean, detail: string | null, error: { code: string; message: string } | null = null) => ({
      ok,
      detail,
      error,
    });

    let ai = item(false, null, { code: 'LLM_UNAVAILABLE', message: 'LLM control plane unavailable' });
    try {
      const state = await this.requireLlm().getState();
      if (state.runtimeProvider === 'local') {
        ai = item(true, 'Local agent runtime (no LLM configured)');
      } else if (state.model) {
        ai = item(true, `${state.model.provider} · ${state.model.id}`);
      } else {
        ai = item(false, null, { code: 'LLM_NO_MODEL', message: 'No model selected' });
      }
    } catch {
      // ai stays failed.
    }

    let marketData = item(false, null, { code: 'MARKET_DATA_UNAVAILABLE', message: 'Market data check failed' });
    try {
      const quoteCapability = this.registry.get('market.quote');
      if (!quoteCapability) {
        marketData = item(false, null, { code: 'CAPABILITY_MISSING', message: 'market.quote capability missing' });
      } else {
        const outcome = await this.executor.run(quoteCapability, { symbol: 'AAPL.US' }, { timeoutMs: 20_000 });
        marketData =
          outcome.record.status === 'success'
            ? item(true, 'Quote check passed (AAPL.US)')
            : item(false, null, { code: 'QUOTE_FAILED', message: outcome.record.error ?? 'Quote check failed' });
      }
    } catch (error) {
      marketData = item(false, null, {
        code: 'QUOTE_FAILED',
        message: error instanceof Error ? error.message : 'Quote check failed',
      });
    }

    const skillsCount = this.skillHub.listSkills().length;
    const skills = item(
      skillsCount > 0,
      skillsCount > 0 ? `${skillsCount} skills loaded` : null,
      skillsCount > 0 ? null : { code: 'NO_SKILLS', message: 'No skills loaded' }
    );

    const agentRuntime = item(true, 'Agent kernel running', null);

    return { ai, marketData, skills, agentRuntime };
  }

  // -------------------------------------------------------------------------
  // Provider connections (spec §8–11)
  // -------------------------------------------------------------------------

  private async providerHealth(provider: AnyProvider): Promise<ProviderHealth | null> {
    try {
      return await provider.status();
    } catch {
      return null;
    }
  }

  /** Renderer-facing mirror of the Connections IPC contract (ui/client/connections.ts). */
  private async entryFor(provider: AnyProvider): Promise<ConnectionEntry> {
    const state = await this.connectionStore.get(provider.id);
    const health = await this.providerHealth(provider);
    const coverage =
      this.providerRouter.coverage().find((c) => c.providerId === provider.id) ?? null;
    const config = await this.connectionStore.getConfig(provider.id);
    let hasAccount = false;
    let accountLabel: string | null = null;
    if (provider.kind === 'broker-account') {
      try {
        const accounts = await provider.accounts();
        if (accounts.ok) {
          hasAccount = accounts.data.length > 0;
          accountLabel = accounts.data[0]?.name ?? null;
        }
      } catch {
        // No account info — entry still renders with hasAccount=false.
      }
    }
    return {
      providerId: provider.id,
      kind: provider.kind,
      name: provider.name,
      status: health?.status ?? state?.status ?? 'not-connected',
      health,
      coverage,
      configurable: provider.id === 'massive',
      configured: Boolean(config?.apiKey),
      hasAccount,
      accountLabel,
      error: state?.error ?? null,
    };
  }

  async listConnections(): Promise<ConnectionEntry[]> {
    return Promise.all(this.providerRouter.list().map((provider) => this.entryFor(provider)));
  }

  async connectProvider(input: unknown): Promise<{ status: 'connecting' | 'connected'; verificationUrl?: string }> {
    const request = requireObject(input);
    const providerId = requireString(request.providerId, 'providerId');
    if (providerId !== 'longbridge') {
      throw createCodeError('CONFIG_UNSUPPORTED', 'Connect is only supported for the Longbridge CLI.');
    }
    if (this.activeLogin) {
      throw createCodeError('LOGIN_IN_PROGRESS', 'A Longbridge login is already in progress.');
    }
    await this.connectionStore.update({ providerId, status: 'connecting', lastCheck: Date.now() });

    const controller = new AbortController();
    let resolveUrl: (uri: string | undefined) => void;
    const urlPromise = new Promise<string | undefined>((resolve) => {
      resolveUrl = resolve;
    });
    const urlTimer = setTimeout(() => resolveUrl(undefined), 30_000);

    const outcomePromise = startLogin({
      exec: executeLongBridgeCli,
      spawn: spawnLongbridge,
      openUrl: (uri) => shell.openExternal(uri),
      onVerificationUri: (uri) => {
        clearTimeout(urlTimer);
        resolveUrl(uri);
      },
      signal: controller.signal,
    });
    this.activeLogin = {
      cancel: () => controller.abort(),
    };

    const verificationUrl = await urlPromise;
    if (!verificationUrl) {
      controller.abort();
      this.activeLogin = null;
      throw createCodeError('LOGIN_START_FAILED', 'Could not start the Longbridge authorization flow.');
    }

    // The device flow continues in the background; completion updates the
    // connection store and pushes `connections:changed` to the renderer.
    void outcomePromise
      .then(async (outcome) => {
        if (outcome.status === 'connected') {
          await this.connectionStore.update({
            providerId,
            status: 'connected',
            lastCheck: Date.now(),
            connectedAt: Date.now(),
          });
        } else if (outcome.status === 'cancelled') {
          await this.connectionStore.update({ providerId, status: 'not-connected', lastCheck: Date.now() });
        } else {
          await this.connectionStore.update({
            providerId,
            status: 'error',
            lastCheck: Date.now(),
            error: { code: 'LOGIN_TIMEOUT', message: 'Authorization timed out. Try again.' },
          });
        }
        this.activeLogin = null;
        void this.pushConnections();
      })
      .catch(() => {
        this.activeLogin = null;
        void this.pushConnections();
      });

    return { status: 'connecting', verificationUrl };
  }

  async cancelConnectProvider(input: unknown): Promise<void> {
    requireObject(input);
    this.activeLogin?.cancel();
  }

  async disconnectProvider(input: unknown): Promise<ConnectionEntry | null> {
    const request = requireObject(input);
    const providerId = requireString(request.providerId, 'providerId');
    const provider = this.providerRouter.get(providerId);
    if (!provider) return null;
    if (providerId === 'longbridge') {
      await longbridgeLogout({ exec: executeLongBridgeCli });
    }
    await this.connectionStore.update({ providerId, status: 'not-connected', lastCheck: Date.now() });
    return this.entryFor(provider);
  }

  async testProviderConnection(input: unknown): Promise<ProviderHealth> {
    const request = requireObject(input);
    const providerId = requireString(request.providerId, 'providerId');
    if (providerId === 'longbridge') {
      return longbridgeTestConnection({ exec: executeLongBridgeCli });
    }
    const provider = this.providerRouter.get(providerId);
    if (!provider) throw createCodeError('UNKNOWN_PROVIDER', 'Unknown provider.');
    return (await this.providerHealth(provider)) ?? {
      status: 'error',
      lastCheck: Date.now(),
      message: 'Provider did not answer a health probe.',
    };
  }

  async setProviderConfig(input: unknown): Promise<ConnectionEntry> {
    const request = requireObject(input);
    const providerId = requireString(request.providerId, 'providerId');
    const config = requireObject(request.config);
    if (providerId !== 'massive') {
      throw createCodeError('CONFIG_UNSUPPORTED', 'Only API-key providers accept config.');
    }
    const apiKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : '';
    if (!apiKey) {
      throw createCodeError('INVALID_ARGUMENT', 'An API key is required.');
    }
    await this.connectionStore.setConfig(providerId, { apiKey });
    const massive = this.providerRouter.get('massive');
    if (massive instanceof MassiveFinancialDataProvider) {
      massive.clearCache();
    }
    return this.entryFor(this.providerRouter.get(providerId)!);
  }

  async coverageMatrix(): Promise<ProviderCoverage[]> {
    return this.providerRouter.coverage();
  }

  // -------------------------------------------------------------------------
  // V5: screening / diff / outcome / import (spec §5–49)
  // -------------------------------------------------------------------------

  async screeningRun(input: unknown): Promise<ScreeningRun> {
    const request = requireObject(input);
    const strategy = requireString(request.strategy, 'strategy');
    if (!SCREENING_STRATEGIES.some((def) => def.id === strategy)) {
      throw createCodeError('SCREENING_STRATEGY_INVALID', `Unknown screening strategy: ${strategy}`);
    }
    const query: ScreeningQuery = {
      strategy: strategy as ScreeningStrategy,
      universe: Array.isArray(request.universe) ? request.universe.map(String) : undefined,
      market: typeof request.market === 'string' ? request.market : undefined,
      filters: isRecord(request.filters) ? request.filters : undefined,
      limit: typeof request.limit === 'number' ? request.limit : 20,
    };
    return this.screeningService.runScreening(query);
  }

  async screeningListRuns(): Promise<ScreeningRun[]> {
    return this.screeningService.listRuns();
  }

  async screeningGetRun(input: unknown): Promise<ScreeningRun | undefined> {
    const request = requireObject(input);
    return this.screeningService.getRun(requireString(request.runId, 'runId'));
  }

  async researchGetDiff(input: unknown): Promise<ResearchDiff | undefined> {
    const request = requireObject(input);
    const symbol = requireString(request.symbol, 'symbol').toUpperCase();
    const cached = await this.diffRepository.getBySymbol(symbol);
    if (cached) return cached;
    // Fallback: build on demand from the two latest reports.
    const reports = await this.researchService.listReports(symbol);
    if (reports.length < 2) return undefined;
    const sorted = [...reports].sort((a, b) => b.generatedAt - a.generatedAt);
    const diff = await buildDiff(sorted[1]!, sorted[0]!, {
      thesis: await this.latestThesisFor(symbol),
    });
    await this.diffRepository.save(diff);
    return diff;
  }

  async outcomeListOpinions(input: unknown): Promise<ResearchOpinion[]> {
    const request = isRecord(input) ? input : {};
    return this.outcomeRepository.listOpinions(
      typeof request.symbol === 'string' ? request.symbol.toUpperCase() : undefined
    );
  }

  async outcomeListOutcomes(input: unknown): Promise<ResearchOutcome[]> {
    const request = isRecord(input) ? input : {};
    return this.outcomeRepository.listOutcomes(
      typeof request.symbol === 'string' ? request.symbol.toUpperCase() : undefined
    );
  }

  async outcomeEvaluateDue(): Promise<ResearchOutcome[]> {
    return this.outcomeService.evaluateDue(undefined, this.fetchOutcomeHistory);
  }

  async importParse(input: unknown): Promise<PortfolioImportDraft> {
    const request = requireObject(input);
    const source = requireString(request.source, 'source');
    const text = requireString(request.text, 'text');
    let rows: PortfolioImportRow[];
    if (source === 'csv') {
      rows = parseCsv(text);
    } else if (source === 'paste') {
      rows = parsePaste(text);
    } else {
      throw createCodeError('IMPORT_SOURCE_INVALID', 'Unsupported import source.');
    }
    return createDraft(source as ImportSource, rows);
  }

  async importConfirm(input: unknown): Promise<ManualPortfolio> {
    const request = requireObject(input);
    const draft = requireObject(request.draft) as unknown as PortfolioImportDraft;
    const name = requireString(request.name, 'name');
    const rows = Array.isArray(draft.rows) ? draft.rows : [];
    if (rows.length === 0) {
      throw createCodeError('IMPORT_EMPTY', 'Nothing to import — the draft has no rows.');
    }
    const holdings: Holding[] = rows
      .filter((row) => row.symbol && row.issues.length === 0)
      .map((row) => ({
        symbol: row.symbol.toUpperCase(),
        name: row.name ?? '',
        currency: row.currency,
        quantity: row.quantity,
        costPrice: row.costPrice,
      }));
    return this.importRepository.create({ name, holdings });
  }

  async listManualPortfolios(): Promise<ManualPortfolio[]> {
    return this.importRepository.list();
  }

  private async latestThesisFor(symbol: string): Promise<InvestmentThesis | undefined> {
    try {
      const theses = await this.thesisRepository.getBySymbol(symbol);
      return theses[0];
    } catch {
      return undefined;
    }
  }

  /** Persist a diff when a symbol gets a NEW report over an older one (spec §17–19). */
  private async saveDiffForReport(report: ResearchReport): Promise<void> {
    try {
      const older = (await this.researchService.listReports(report.symbol))
        .filter((other) => other.id !== report.id)
        .sort((a, b) => b.generatedAt - a.generatedAt);
      if (older.length === 0) return;
      const diff = await buildDiff(older[0]!, report, {
        thesis: await this.latestThesisFor(report.symbol),
      });
      await this.diffRepository.save(diff);
    } catch {
      // Diff persistence is best-effort; the UI can build on demand.
    }
  }

  /** Historical daily bars for outcome evaluation (spec §32). */
  private fetchOutcomeHistory: HistoryFetcher = async (symbol) => {
    const capability = this.registry.get('market.kline');
    if (!capability) return null;
    const outcome = await this.executor.run(
      capability,
      { symbol, period: '1d', limit: 200 },
      { timeoutMs: 20_000 }
    );
    if (outcome.record.status !== 'success' || !outcome.result) return null;
    return (outcome.result.data as Kline[] | undefined) ?? null;
  };

  // -------------------------------------------------------------------------
  // V5 Phase 2: pulse / performance / automation / export (spec §21–55)
  // -------------------------------------------------------------------------

  async pulseSnapshot(input: unknown): Promise<MarketPulseSnapshot> {
    const request = isRecord(input) ? input : {};
    const watchlistRaw = Array.isArray(request.watchlist) ? request.watchlist : undefined;
    const watchlist: WatchlistQuote[] = Array.isArray(watchlistRaw)
      ? (watchlistRaw as unknown as WatchlistQuote[])
      : [];
    const portfolioSummary = isRecord(request.portfolioSummary)
      ? (request.portfolioSummary as unknown as PortfolioSnapshot)
      : undefined;
    return this.pulseService.snapshot({
      watchlist,
      portfolioSummary,
      market: 'US',
    });
  }

  async performanceSkillPerformance(input: unknown): Promise<SkillPerformance[]> {
    const request = isRecord(input) ? input : {};
    const horizon = request.horizon;
    if (horizon !== '1w' && horizon !== '1m' && horizon !== '3m') {
      throw createCodeError('PERFORMANCE_HORIZON_INVALID', 'Horizon must be 1w, 1m, or 3m.');
    }
    return this.performanceService.skillPerformance(horizon);
  }

  async performanceStrategyPerformance(input: unknown): Promise<StrategyPerformance[]> {
    const request = isRecord(input) ? input : {};
    const horizon = request.horizon;
    if (horizon !== '1w' && horizon !== '1m' && horizon !== '3m') {
      throw createCodeError('PERFORMANCE_HORIZON_INVALID', 'Horizon must be 1w, 1m, or 3m.');
    }
    return this.performanceService.strategyPerformance(horizon);
  }

  async performanceSkillCalibration(input: unknown): Promise<SkillCalibration[]> {
    const request = isRecord(input) ? input : {};
    const horizon = request.horizon;
    if (horizon !== '1w' && horizon !== '1m' && horizon !== '3m') {
      throw createCodeError('PERFORMANCE_HORIZON_INVALID', 'Horizon must be 1w, 1m, or 3m.');
    }
    const opinions = await this.outcomeRepository.listOpinions();
    const outcomes = await this.outcomeRepository.listOutcomes();
    return computeSkillCalibrations(opinions, outcomes, horizon);
  }

  async performanceStrategyCalibration(input: unknown): Promise<StrategyCalibration[]> {
    const request = isRecord(input) ? input : {};
    const horizon = request.horizon;
    if (horizon !== '1w' && horizon !== '1m' && horizon !== '3m') {
      throw createCodeError('PERFORMANCE_HORIZON_INVALID', 'Horizon must be 1w, 1m, or 3m.');
    }
    const opinions = await this.outcomeRepository.listOpinions();
    const outcomes = await this.outcomeRepository.listOutcomes();
    return computeStrategyCalibrations(opinions, outcomes, horizon);
  }

  async automationListRules(): Promise<AutomationRule[]> {
    return this.automationRules.list();
  }

  async automationSaveRule(input: unknown): Promise<AutomationRule> {
    const request = requireObject(input);
    const rule = request.rule as unknown as AutomationRule;
    if (!rule || typeof rule.type !== 'string') {
      throw createCodeError('AUTOMATION_RULE_INVALID', 'A valid automation rule is required.');
    }
    return this.automationRules.save(rule);
  }

  async automationRemoveRule(input: unknown): Promise<void> {
    const request = requireObject(input);
    await this.automationRules.remove(requireString(request.ruleId, 'ruleId'));
  }

  async automationRunRule(input: unknown): Promise<AutomationRun> {
    const request = requireObject(input);
    const ruleId = requireString(request.ruleId, 'ruleId');
    const rule = (await this.automationRules.list()).find((r) => r.id === ruleId);
    if (!rule) throw createCodeError('AUTOMATION_RULE_NOT_FOUND', 'Unknown automation rule.');
    const run = await this.executeAutomation(rule);
    await this.automationRuns.record(run);
    return run;
  }

  async automationListRuns(): Promise<AutomationRun[]> {
    return this.automationRuns.list();
  }

  async automationBuildBrief(): Promise<DailyBrief> {
    const [runs, alerts, diffs] = await Promise.all([
      this.automationRuns.list(),
      this.alertEventLog.list(),
      this.diffRepository.list(),
    ]);
    let portfolio: BriefPortfolioSummary[] = [];
    try {
      const snapshot = await this.marketData.getPortfolio();
      const holdings = snapshot.holdings ?? [];
      const total = snapshot.totalAssets;
      portfolio = holdings
        .filter((holding) => typeof holding.marketValue === 'number' && typeof total === 'number')
        .map((holding) => ({
          label: `${holding.symbol} · ${(((holding.marketValue ?? 0) / (total ?? 1)) * 100).toFixed(1)}% of portfolio`,
          symbol: holding.symbol,
        }));
    } catch {
      // No portfolio — brief renders without the portfolio section.
    }
    return buildBrief({ runs, alerts, diffs, portfolio, movers: [] }, Date.now());
  }

  async exportMarkdown(input: unknown): Promise<string> {
    const request = requireObject(input);
    const report = await this.researchService.getReport(requireString(request.reportId, 'reportId'));
    if (!report) throw createCodeError('REPORT_NOT_FOUND', 'Unknown research report.');
    return reportToMarkdown(redactForShare(report));
  }

  async exportShareCard(input: unknown): Promise<ShareCard> {
    const request = requireObject(input);
    const report = await this.researchService.getReport(requireString(request.reportId, 'reportId'));
    if (!report) throw createCodeError('REPORT_NOT_FOUND', 'Unknown research report.');
    return reportToShareCard(redactForShare(report));
  }

  private async seedAutomationRules(): Promise<void> {
    try {
      const existing = await this.automationRules.list();
      if (existing.length > 0) return;
      const now = Date.now();
      const defaults: AutomationRule[] = [
        {
          id: 'watchlist-daily-review',
          type: 'watchlist-daily-review',
          enabled: true,
          hour: DEFAULT_BRIEF_HOUR,
          days: [...WEEKDAYS],
          symbols: ['AAPL.US', 'TSLA.US', 'NVDA.US'],
          strategyId: 'comprehensive',
          notify: 'material-only',
          createdAt: now,
        },
        {
          id: 'portfolio-daily-brief',
          type: 'portfolio-daily-brief',
          enabled: true,
          hour: DEFAULT_BRIEF_HOUR,
          days: [...WEEKDAYS],
          strategyId: 'comprehensive',
          notify: 'material-only',
          createdAt: now,
        },
        {
          id: 'weekly-thesis-review',
          type: 'weekly-thesis-review',
          enabled: true,
          hour: THESIS_REVIEW_HOUR,
          days: [THESIS_REVIEW_DAY],
          strategyId: 'risk-review',
          notify: 'material-only',
          createdAt: now,
        },
        {
          id: 'pre-earnings-research',
          type: 'pre-earnings-research',
          enabled: true,
          strategyId: 'earnings',
          notify: 'material-only',
          createdAt: now,
        },
        {
          id: 'post-earnings-research',
          type: 'post-earnings-research',
          enabled: true,
          strategyId: 'earnings',
          notify: 'material-only',
          createdAt: now,
        },
      ];
      for (const rule of defaults) {
        await this.automationRules.save(rule);
      }
    } catch {
      // Seeding is best-effort; rules can be created in the UI.
    }
  }

  private startAutomationScheduler(): void {
    this.automationTimer = setInterval(() => {
      void this.tickAutomations();
    }, 60_000);
  }

  private async tickAutomations(): Promise<void> {
    try {
      const rules = await this.automationRules.list();
      const now = Date.now();
      const todayKey = new Date(now).toDateString();
      for (const rule of runDue(rules, now)) {
        if (this.lastAutomationRunByRule.get(rule.id) === todayKey) continue;
        try {
          const run = await this.executeAutomation(rule);
          await this.automationRuns.record(run);
          this.lastAutomationRunByRule.set(rule.id, todayKey);
        } catch {
          // A failing rule never blocks the other rules.
        }
      }
    } catch {
      // Scheduler tick is best-effort.
    }
  }

  private async executeAutomation(rule: AutomationRule): Promise<AutomationRun> {
    return runAutomation(rule, {
      registry: this.registry,
      diffRepo: this.diffRepository,
      locale: await this.effectiveRunLocale(),
      researchStart: async (symbol, strategyId) => this.researchService.start(symbol, strategyId, await this.effectiveRunLocale()),
      notify: (event) => void this.dispatchNotification(event),
      portfolioSymbols: async () => {
        try {
          const snapshot = await this.marketData.getPortfolio();
          return (snapshot.holdings ?? []).map((holding) => holding.symbol);
        } catch {
          return [];
        }
      },
      thesisSymbols: async () => {
        try {
          const summaries = await this.thesisRepository.list();
          return summaries.map((thesis) => thesis.symbol);
        } catch {
          return [];
        }
      },
    });
  }

  /** Unified V5 notification dispatcher (spec §56–57): OS + in-app push. */
  private dispatchNotification(event: NotificationEvent): void {
    try {
      if (Notification.isSupported()) {
        new Notification({ title: event.title, body: event.message }).show();
      }
    } catch {
      // OS notification best-effort.
    }
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('notification:event', event);
    }
  }

  // -------------------------------------------------------------------------
  // Onboarding persistence (spec §27–30, §42) — main-side so the flag
  // survives restarts regardless of web-storage behavior in packaged builds.
  // -------------------------------------------------------------------------

  async getOnboardingCompleted(): Promise<boolean> {
    const store = new JsonFileStore(app.getPath('userData'));
    const file = await store.read<{ completed?: boolean }>('onboarding.json', {});
    return file.completed === true;
  }

  async setOnboardingCompleted(input: unknown): Promise<void> {
    const request = requireObject(input);
    const completed = request.completed === true;
    const store = new JsonFileStore(app.getPath('userData'));
    await store.write('onboarding.json', { completed });
  }

  // -------------------------------------------------------------------------
  // App preferences (V8 spec §14–16): main-owned so the effective locale is
  // known by OS notifications, dialogs, and the agent runtime — not just the
  // renderer. Stored alongside onboarding in userData (JsonFileStore).
  // -------------------------------------------------------------------------

  async getAppPreferences(): Promise<AppPreferencesSnapshot> {
    return this.appPreferences.get();
  }

  async updateAppPreferences(input: unknown): Promise<AppPreferencesSnapshot> {
    const request = requireObject(input);
    if (!isLocalePreference(request.locale)) {
      throw createCodeError('INVALID_ARGUMENT', 'Invalid locale preference.');
    }
    return this.appPreferences.update(request.locale);
  }

  private async pushConnections(): Promise<void> {
    try {
      const entries = await this.listConnections();
      if (this.window && !this.window.isDestroyed()) {
        this.window.webContents.send('connections:changed', entries);
      }
    } catch {
      // Push is best-effort; the UI can re-list on demand.
    }
  }

  private listFinancialProviders(): FinancialProviderSummary[] {
    return this.providerRouter.list().map((provider) => {
      const coverage = this.providerRouter.coverage().find((c) => c.providerId === provider.id);
      return {
        id: provider.id,
        status: provider.kind,
        coverage: {
          capabilities: coverage?.capabilities ?? [],
          markets: (coverage?.markets ?? []).map((m) => m.id),
        },
      };
    });
  }

  // -------------------------------------------------------------------------
  // Skills
  // -------------------------------------------------------------------------

  async listSkills() {
    const metadataById = new Map(this.skillHub.listSkillMetadata().map((m) => [m.id, m]));
    return this.skillHub.listSkills().map((skill) => {
      const meta = metadataById.get(skill.id);
      return {
        id: skill.id,
        name: skill.name,
        keywords: skill.trigger.keywords,
        enabled: skill.metadata.enabled,
        description: meta?.description ?? '',
        riskLevel: meta?.riskLevel,
        tier: meta?.tier,
        version: meta?.version,
        author: meta?.author,
      };
    });
  }

  async setSkillEnabled(input: unknown): Promise<void> {
    const request = requireObject(input);
    await this.skillHub.setEnabled(
      requireString(request.skillId, 'skillId'),
      request.enabled === true
    );
  }

  async listSkillResources(skillId: unknown) {
    return this.skillHub.listSkillResources(requireString(skillId, 'skillId'));
  }

  async readSkillResource(skillId: unknown, relativePath: unknown) {
    return this.skillHub.readSkillResource(
      requireString(skillId, 'skillId'),
      requireString(relativePath, 'relativePath')
    );
  }

  // -------------------------------------------------------------------------

  /** Runtime env for each Pi spawn: Folio-owned provider overrides + skills dir. */
  private async buildRuntimeEnv(): Promise<NodeJS.ProcessEnv> {
    const overrides: Array<Record<string, unknown>> = [];
    const baseUrlEnv = process.env.ANTHROPIC_BASE_URL;
    if (baseUrlEnv) {
      overrides.push({ provider: 'anthropic', baseUrl: baseUrlEnv });
    }
    for (const provider of await this.credentials.listCustomProviders()) {
      overrides.push({
        provider: provider.name,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        api: provider.api,
        models: provider.models,
      });
    }
    for (const info of await this.credentials.listCredentials()) {
      if (info.custom) continue;
      const apiKey = await this.credentials.getCredential(info.provider);
      if (!apiKey) continue;
      overrides.push({ provider: info.provider, apiKey });
    }
    const env: NodeJS.ProcessEnv = {
      FINAGENT_SKILLS_DIR: getSkillsDir(),
      FINAGENT_PROVIDER_OVERRIDES: overrides.length > 0 ? JSON.stringify(overrides) : '',
      // V7: the Finagent extension enforces tool-output privacy from this flag
      // (spec §60) — always set so the level is unambiguous.
      FINAGENT_PRIVACY_LEVEL: this.evaluationSettings.privacyLevel,
    };
    // V7: LangSmith tracing env (spec §13). Config comes from safeStorage-backed
    // settings; the extension reads these at Pi process start, so toggling
    // tracing restarts the runtime (see setEvaluationSettings). Trace metadata
    // is app-level only — run-level data flows through TraceCorrelationService.
    if (this.evaluationSettings.tracingEnabled) {
      const key = await this.credentials.getCredential('langsmith');
      if (key) {
        env.TRACE_TO_LANGSMITH = 'true';
        env.LANGSMITH_PI_API_KEY = key;
        env.LANGSMITH_PI_PROJECT = this.evaluationSettings.langsmithProject;
        if (this.evaluationSettings.langsmithEndpoint) {
          env.LANGSMITH_PI_ENDPOINT = this.evaluationSettings.langsmithEndpoint;
        }
        env.LANGSMITH_PI_METADATA = JSON.stringify({
          app: 'folio',
          environment: 'production',
          privacyLevel: this.evaluationSettings.privacyLevel,
        });
      }
    }
    return env;
  }

  async dispose() {
    this.alertEngine.stop();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.unsubscribeEval?.();
    this.unsubscribeEval = null;
    this.window = null;
    await this.kernel.dispose();
  }
}

function getLongBridgeStatusAction(status: string) {
  switch (status) {
    case 'not_installed':
      return 'Install the LongBridge CLI (longbridge --help) and authenticate with longbridge auth login.';
    case 'not_authed':
      return 'Run longbridge auth login to authenticate the LongBridge CLI.';
    case 'rate_limited':
      return 'LongBridge is rate-limited; market data requests are paused. Try again later.';
    default:
      return undefined;
  }
}

export function toIpcError(error: unknown): IpcFailure['error'] {
  if (isCodeError(error)) {
    return {
      code: error.code,
      message: redactSecrets(error.message),
      action: error.action,
    };
  }
  if (error instanceof Error) {
    return {
      code: 'INTERNAL_ERROR',
      message: redactSecrets(error.message),
    };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: redactSecrets(String(error)),
  };
}

/**
 * Main-process error ring buffer (spec §43). IPC failures and service errors
 * are pushed here already redacted; the diagnostics collector ships the last
 * 20 entries. Renderer-side errors stay renderer-side.
 */
export const mainErrorLog = new ErrorLog();

export async function toIpcResult<T>(operation: () => Promise<T> | T): Promise<IpcResult<T>> {
  try {
    const data = await operation();
    return { ok: true, data };
  } catch (error) {
    const ipcError = toIpcError(error);
    mainErrorLog.push({
      at: Date.now(),
      source: 'main',
      message: ipcError.message,
      stack: error instanceof Error ? (error.stack ?? null) : null,
    });
    return { ok: false, error: ipcError };
  }
}

function readAgentProvider() {
  const value = process.env.FINAGENT_AGENT_PROVIDER;
  return value === 'local' ? 'local' : 'pi-runtime';
}

/** Real CLI exec for the Longbridge providers (main process only). */
const executeLongBridgeCli: LongbridgeExec = (args, options) =>
  executeLongBridge(args, { timeout: options?.timeout });

/** Spawn the Longbridge CLI; stdout chunks stream to the login flow. */
const spawnLongbridge: SpawnFn = (args, onStdout) => {
  const child = spawn('longbridge', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk: Buffer) => onStdout(chunk.toString()));
  child.stderr.resume();
  return { kill: () => child.kill() };
};

function readRequiredLlmEnvKeys() {
  return process.env.FINAGENT_LLM_ENV_KEYS?.split(',')
    .map((key) => key.trim())
    .filter(Boolean) ?? [];
}

function isApiResult<T>(value: unknown): value is ApiResult<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ok' in value
  );
}

function requireString(value: unknown, field: string) {
  if (typeof value !== 'string' || value.length === 0) {
    throw createCodeError('INVALID_ARGUMENT', `${field} must be a non-empty string.`);
  }
  return value;
}

function requireObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw createCodeError('INVALID_ARGUMENT', 'Expected an object payload.');
  }
  return value as Record<string, unknown>;
}

function createCodeError(code: string, message: string, action?: string) {
  const error = new Error(message) as Error & { code: string; action?: string };
  error.code = code;
  if (action) error.action = action;
  return error;
}

function isCodeError(error: unknown): error is Error & { code: string; action?: string } {
  return error instanceof Error && typeof (error as { code?: unknown }).code === 'string';
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && typeof (error as NodeJS.ErrnoException).code === 'string';
}

// -- V3 prompt builders ------------------------------------------------------

function buildSynthesisPrompt(input: ResearchSynthesisInput): string {
  return [
    'You are the Folio research synthesizer. Analyze the structured market data below',
    `for ${input.symbol} and produce a JSON research synthesis.`,
    '',
    'Planned capabilities: ' + input.plannedCapabilities.join(', '),
    '',
    'Capability outcomes:',
    ...input.runs.map(
      (run) =>
        `- ${run.capabilityId}: ${run.status}${run.error ? ` (error: ${run.error})` : ''}${run.summary ? ` — ${run.summary}` : ''}`
    ),
    '',
    'Structured data bundle (facts; never invent values not present here):',
    '```json',
    input.dataBundle,
    '```',
    '',
    'Respond with ONLY a JSON object matching this shape (no prose outside it):',
    '{"summary": string, "stance": "bullish"|"bearish"|"neutral", "confidence": 0..1,',
    ' "sections": [{"key": string, "title": string, "verdict": "positive"|"negative"|"neutral"|"unavailable", "summary": string}],',
    ' "bullCase": string[], "bearCase": string[], "catalysts": string[], "risks": string[]}',
    '',
    'Sections must cover every planned capability; a capability that failed or has no data',
    'gets verdict "unavailable" with an explicit note. Do not fabricate numbers or events.',
  ].join('\n');
}

function buildImpactPrompt(input: ThesisImpactInput): string {
  return [
    'You are the Folio thesis evaluator. Compare the existing investment thesis',
    `for ${input.thesis.symbol} against the fresh data below and decide how the new facts`,
    'affect the thesis.',
    '',
    'Existing thesis (JSON):',
    '```json',
    JSON.stringify(input.thesis, null, 2),
    '```',
    '',
    'Fresh data bundle:',
    '```json',
    input.dataBundle,
    '```',
    '',
    'Respond with ONLY a JSON object matching this shape:',
    '{"kind": "unchanged"|"strengthened"|"weakened"|"invalidated",',
    ' "summary": "one clear sentence explaining why",',
    ' "updatedThesis": <the full InvestmentThesis JSON with updatedAt/lastReviewedAt set to now and',
    '   any stance/cases/risks adjusted to reflect the new facts>}',
    '',
    'updatedThesis must keep every field of the original thesis; only adjust what the new facts',
    'actually change. Never invent data.',
  ].join('\n');
}

function buildRiskSummaryPrompt(input: PortfolioRiskSynthesisInput): string {
  return [
    'You are the Folio portfolio risk analyst. Summarize the top risk findings from the',
    'structured portfolio data below in 2-4 sentences of plain prose (no JSON, no markdown).',
    '',
    'Allocation: ' + JSON.stringify(input.allocation),
    'Concentration: ' + JSON.stringify(input.concentration),
    'Signals: ' + JSON.stringify(input.signals),
    '',
    'Mention only what the data supports; if there are no signals, say the portfolio looks',
    'balanced and note any missing data explicitly.',
  ].join('\n');
}

export { isApiResult };
