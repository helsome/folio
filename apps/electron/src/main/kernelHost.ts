import { join } from 'node:path';
import { app, Notification, type BrowserWindow } from 'electron';
import type {
  AgentEvent,
  AlertRule,
  AlertTriggerEvent,
  ApiResult,
  CapabilityRegistry,
  Comparison,
  CredentialInfo,
  CustomProviderConfig,
  InvestmentThesis,
  LlmModel,
  LlmRuntimeState,
  LlmTestResult,
  Message,
  PortfolioRiskReport,
  ProviderStatus,
  ResearchReport,
  ResearchRunSummary,
  ResearchSynthesis,
  ResearchSynthesisInput,
  Run,
  SessionMeta,
  SkillReadiness,
  ThesisImpact,
  ThesisImpactInput,
  ToolDefinition,
  WorkspaceContext,
} from '@finagent/core';
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
  defaultPortfolioRiskSynthesizer,
  FinanceToolRegistry,
  JsonFileStore,
  LocalResearchSynthesizer,
  MarketDataService,
  parseImpactJson,
  parseSynthesisJson,
  PortfolioRiskService,
  ResearchReportRepository,
  ResearchService,
  ThesisImpactRepository,
  ThesisRepository,
  ThesisService,
  type PortfolioRiskSynthesisInput,
} from '@finagent/shared';
import { SkillHub, skillCapabilityMap } from '@finagent/skill-hub';
import { getPiCwd, getPiExtensionEntry, getSkillsDir } from '@finagent/shared/resources';
import { CredentialStore, redactSecrets } from './credentialStore.ts';

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
  private readonly thesisRepository: ThesisRepository;
  private readonly thesisService: ThesisService;
  private readonly alertRepository: AlertRuleRepository;
  private readonly alertEventLog: AlertEventLog;
  private readonly alertEngine: AlertEngine;
  private readonly portfolioRisk: PortfolioRiskService;
  private unsubscribe: (() => void) | null = null;
  private window: BrowserWindow | null = null;

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

    this.registry = createFullRegistry();
    this.executor = new CapabilityExecutor();

    this.researchService = new ResearchService({
      registry: this.registry,
      synthesizer:
        provider === 'local'
          ? new LocalResearchSynthesizer()
          : createAgentSynthesizer(this.runResearchSynthesis),
      repository: new ResearchReportRepository(new JsonFileStore(join(userData, 'store'))),
    });

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
    void this.skillHub.loadSkills();
    this.alertEngine.start();
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
    return this.kernel.runs.startRun(
      requireString(request.sessionId, 'sessionId'),
      requireString(request.content, 'content'),
      workspaceContext
    );
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
    return this.researchService.start(requireString(request.symbol, 'symbol').toUpperCase());
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
    const session = await this.kernel.sessions.createSession('Research');
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
  // Skills
  // -------------------------------------------------------------------------

  async listSkills() {
    return this.skillHub.listSkills().map((skill) => ({
      id: skill.id,
      name: skill.name,
      keywords: skill.trigger.keywords,
      enabled: skill.metadata.enabled,
      description: this.skillHub.listSkillMetadata().find((m) => m.id === skill.id)?.description ?? '',
      riskLevel: this.skillHub.listSkillMetadata().find((m) => m.id === skill.id)?.riskLevel,
      tier: this.skillHub.listSkillMetadata().find((m) => m.id === skill.id)?.tier,
    }));
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
    return {
      FINAGENT_SKILLS_DIR: getSkillsDir(),
      FINAGENT_PROVIDER_OVERRIDES: overrides.length > 0 ? JSON.stringify(overrides) : '',
    };
  }

  async dispose() {
    this.alertEngine.stop();
    this.unsubscribe?.();
    this.unsubscribe = null;
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

export async function toIpcResult<T>(operation: () => Promise<T> | T): Promise<IpcResult<T>> {
  try {
    const data = await operation();
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: toIpcError(error) };
  }
}

function readAgentProvider() {
  const value = process.env.FINAGENT_AGENT_PROVIDER;
  return value === 'local' ? 'local' : 'pi-runtime';
}

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
