import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, type BrowserWindow } from 'electron';
import type {
  AgentEvent,
  ApiResult,
  CredentialInfo,
  CustomProviderConfig,
  LlmModel,
  LlmRuntimeState,
  LlmTestResult,
  Message,
  ProviderStatus,
  Run,
  SessionMeta,
  ToolDefinition,
  WorkspaceContext,
} from '@finagent/core';
import { AgentKernel, MarketDataService } from '@finagent/shared';
import { SkillHub } from '@finagent/skill-hub';
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
  private readonly workspaceRoot: string;
  private unsubscribe: (() => void) | null = null;

  constructor() {
    // The Pi runtime resolves its extension path (`.pi/extensions/...`)
    // relative to the spawned process cwd, so spawn it from the workspace
    // root rather than the Electron app directory.
    this.workspaceRoot = join(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../'
    );
    this.credentials = new CredentialStore(join(app.getPath('userData'), 'credentials.json'));
    this.skillHub = new SkillHub({
      skillsDirectory: join(this.workspaceRoot, 'skills'),
      stateFile: join(app.getPath('userData'), 'skills-state.json'),
    });
    this.kernel = new AgentKernel({
      storageDir: join(app.getPath('userData'), 'store'),
      piSessionDir: join(app.getPath('userData'), 'pi-sessions'),
      provider: readAgentProvider(),
      marketData: this.marketData,
      skillHub: this.skillHub,
      rpc: {
        cwd: this.workspaceRoot,
        requiredEnvKeys: readRequiredLlmEnvKeys(),
        env: () => this.buildRuntimeEnv(),
      },
    });
    void this.skillHub.loadSkills();
  }

  /** Forward kernel events to the window's renderer. */
  attach(window: BrowserWindow): void {
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

  async loadAlerts() {
    try {
      const contents = await readFile(getAlertsPath(), 'utf8');
      return JSON.parse(contents) as unknown;
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  async saveAlerts(alerts: unknown) {
    await mkdir(dirname(getAlertsPath()), { recursive: true });
    await writeFile(getAlertsPath(), JSON.stringify(alerts, null, 2), 'utf8');
    return alerts;
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
      FINAGENT_SKILLS_DIR: join(this.workspaceRoot, 'skills'),
      FINAGENT_PROVIDER_OVERRIDES: overrides.length > 0 ? JSON.stringify(overrides) : '',
    };
  }

  async dispose() {
    this.unsubscribe?.();
    this.unsubscribe = null;
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

function getAlertsPath() {
  return join(app.getPath('userData'), 'alerts.json');
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

export { isApiResult };
