import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { AgentEvent } from '@finagent/core';

let lastKernelOptions: Record<string, unknown> | null = null;
let lastMarketData: FakeMarketDataService | null = null;
let forwardedEvents: unknown[] = [];

class FakeMarketDataService {
  quoteSymbols: string[] = [];

  async getQuote(symbol: string) {
    this.quoteSymbols.push(symbol);
    return { symbol, lastPrice: 200 };
  }

  async getKline(input: unknown) {
    return [{ input }];
  }

  async getPortfolio() {
    return { totalValue: 1000, cash: 100, positions: [] };
  }

  async getLongBridgeStatus() {
    return {
      installed: true,
      authed: true,
      available: true,
      status: 'available',
    };
  }
}

const fakeSessions = {
  listSessions: async () => [{ id: 's1', title: 'Session A', status: 'idle', messageCount: 0, createdAt: 1, updatedAt: 1 }],
  createSession: async (title?: string) => ({
    id: 's-new',
    title: title ?? 'New Session',
    status: 'idle',
    messageCount: 0,
    createdAt: 1,
    updatedAt: 1,
  }),
  deleteSession: async () => undefined,
  listMessages: async (sessionId: string) => [{ id: 'm1', role: 'user', content: sessionId, timestamp: 1 }],
  listRuns: async () => [],
};

const fakeRuns = {
  subscribe: (_listener: (event: AgentEvent) => void) => () => undefined,
  startRun: async (sessionId: string, content: string) => ({
    id: 'r1',
    sessionId,
    status: 'running',
    input: content,
    startedAt: 1,
  }),
  cancelRun: async () => undefined,
};

class FakeAgentKernel {
  sessions = fakeSessions;
  runs = fakeRuns;

  constructor(options: Record<string, unknown>) {
    lastKernelOptions = options;
  }

  getTools = async () => ({ ok: true, data: [{ name: 'get_quote' }] });
  getLlmApi = () => undefined;
  dispose = async () => undefined;
}

mock.module('electron', () => ({
  app: {
    getPath: () => '/tmp/finagent-test',
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
  },
  Notification: {
    isSupported: () => false,
  },
  shell: {
    openExternal: async () => undefined,
  },
}));

const noopStore = class {
  read = async (_file: string, fallback: unknown) => fallback;
  write = async () => undefined;
  remove = async () => undefined;
};

mock.module('@finagent/shared', () => ({
  AgentKernel: FakeAgentKernel,
  MarketDataService: class extends FakeMarketDataService {
    constructor() {
      super();
      lastMarketData = this;
    }
  },
  FinanceToolRegistry: class {
    constructor() {
      // Capability-backed tool registry under test elsewhere.
    }
  },
  JsonFileStore: noopStore,
  createCodeError: (code: string, message: string, action?: string) => ({
    code,
    message,
    ...(action !== undefined ? { action } : {}),
  }),
  createFullRegistry: () => ({ list: () => [] }),
  CapabilityExecutor: class {},
  ResearchService: class {
    start = async () => undefined;
    cancel = async () => undefined;
    listRuns = async () => [];
    getRun = async () => undefined;
    listReports = async () => [];
    getReport = async () => undefined;
  },
  ResearchReportRepository: class extends noopStore {},
  LocalResearchSynthesizer: class {},
  createAgentSynthesizer: (runner: unknown) => runner,
  createAgentEvaluator: (runner: unknown) => runner,
  createLocalThesisEvaluator: () => ({}),
  ThesisService: class {},
  ThesisRepository: class {
    list = async () => [];
    getBySymbol = async () => [];
  },
  ThesisImpactRepository: class extends noopStore {},
  AlertEngine: class {
    start = () => undefined;
    stop = () => undefined;
  },
  AlertRuleRepository: class {
    list = async () => [];
    save = async () => undefined;
    remove = async () => undefined;
  },
  AlertEventLog: class {
    list = async () => [];
  },
  PortfolioRiskService: class {
    analyze = async () => undefined;
  },
  defaultPortfolioRiskSynthesizer: async () => '',
  buildComparison: async () => undefined,
  computeSkillReadiness: () => undefined,
  parseSynthesisJson: (text: string) => JSON.parse(text),
  parseImpactJson: (text: string) => JSON.parse(text),
  createRouterFetchers: () => ({}),
  MassiveFinancialDataProvider: class {
    clearCache = () => undefined;
  },
  ProviderRouter: class {
    register = () => undefined;
    setRouting = () => undefined;
    get = () => undefined;
    list = () => [];
    coverage = () => [];
  },
  ConnectionStore: class {
    list = async () => [];
    get = async () => undefined;
    getConfig = async () => undefined;
    update = async () => undefined;
    setConfig = async () => undefined;
    subscribe = () => () => undefined;
  },
  OutcomeRepository: class {
    listOpinions = async () => [];
    listOutcomes = async () => [];
  },
  OutcomeService: class {
    createOpinionFromReport = async () => undefined;
    evaluateDue = async () => [];
  },
  ScreeningService: class {
    runScreening = async () => ({ candidates: [] });
    listRuns = async () => [];
    getRun = async () => undefined;
  },
  ScreeningRunRepository: class {
    save = async () => undefined;
    list = async () => [];
    get = async () => undefined;
  },
  SCREENING_STRATEGIES: [],
  ResearchDiffRepository: class {
    save = async () => undefined;
    getBySymbol = async () => undefined;
  },
  ManualPortfolioRepository: class {
    list = async () => [];
    create = async () => undefined;
  },
  buildDiff: async () => ({ changes: [], material: false }),
  createDraft: () => ({ rows: [], warnings: [] }),
  parseCsv: () => [],
  parsePaste: () => [],
  isRecord: (value: unknown) => typeof value === 'object' && value !== null,
  PulseService: class {
    snapshot = async () => ({
      indices: [],
      marketStatus: null,
      temperature: null,
      movers: [],
      personalImpact: null,
      failures: [],
    });
  },
  PerformanceService: class {
    skillPerformance = async () => [];
    strategyPerformance = async () => [];
  },
  AutomationRuleRepository: class {
    list = async () => [];
    save = async () => undefined;
    remove = async () => undefined;
  },
  AutomationRunRepository: class {
    list = async () => [];
    record = async () => undefined;
  },
  buildBrief: () => ({
    generatedAt: 0,
    items: [],
    summary: '',
    quiet: { count: 0, message: '' },
  }),
  runAutomation: async () => ({
    id: 'run',
    ruleId: 'rule',
    ranAt: 0,
    evaluated: 0,
    materialChanges: 0,
    analyzed: 0,
    notified: false,
    failures: [],
  }),
  runDue: () => [],
  DEFAULT_BRIEF_HOUR: 16.5,
  THESIS_REVIEW_DAY: 0,
  THESIS_REVIEW_HOUR: 9,
  WEEKDAYS: [1, 2, 3, 4, 5],
  reportToMarkdown: () => '',
  reportToShareCard: () => ({ svg: '', text: '' }),
  redactForShare: (report: unknown) => report,
  computeSkillCalibrations: () => [],
  computeStrategyCalibrations: () => [],
  // V7 evaluation/observability (kernelHost constructor wiring; spec §15).
  EvaluationStore: class {
    getSettingsSync = () => ({
      tracingEnabled: false,
      langsmithProject: 'folio-agent',
      langsmithEndpoint: '',
      privacyLevel: 'standard',
      onlineEvaluationEnabled: false,
      apiKeyConfigured: false,
      updatedAt: 0,
    });
    saveSettings = async (settings: unknown) => settings;
    getSettings = async () => ({});
    addRun = async () => undefined;
    listExperiments = async () => [];
    getExperiment = async () => undefined;
    listRuns = async () => [];
    listResults = async () => [];
    listBaselines = async () => [];
    listDatasets = async () => [];
    addFeedback = async () => undefined;
    listFeedback = async () => [];
    recordTraceLink = async () => undefined;
    lookupTraceLink = async () => undefined;
  },
  TraceCorrelationService: class {
    recordRun = async () => ({ backend: 'none' });
    lookup = async () => undefined;
  },
  resolveBackend: () => ({
    kind: 'none',
    status: async () => ({ kind: 'none', available: true }),
    findTraces: async () => [],
  }),
  EvaluationRedactor: class {
    redactAnswer = (answer: string | undefined) => answer;
    redactToolCall = (toolCall: unknown) => toolCall;
  },
  PiRuntimeAdapter: class {},
  sanitizeSettings: (input: unknown) => input,
  embeddedDatasets: [],
}));

mock.module('@finagent/skill-hub', () => ({
  SkillHub: class {
    loadSkills = async () => undefined;
    listSkills = () => [];
    listSkillMetadata = () => [];
    setEnabled = async () => undefined;
    listSkillResources = async () => [];
    readSkillResource = async () => '';
  },
  skillCapabilityMap: {},
}));

const { AgentKernelHost } = await import('./kernelHost.ts');

// The constructor sets FINAGENT_PI_EXTENSION as a process-wide side effect;
// restore it so sibling test files (shared process) see the default args.
const originalPiExtension = process.env.FINAGENT_PI_EXTENSION;

beforeEach(() => {
  lastKernelOptions = null;
  lastMarketData = null;
  forwardedEvents = [];
});

afterEach(() => {
  if (originalPiExtension === undefined) {
    delete process.env.FINAGENT_PI_EXTENSION;
  } else {
    process.env.FINAGENT_PI_EXTENSION = originalPiExtension;
  }
});

describe('AgentKernelHost', () => {
  it('builds the kernel on the electron userData store', () => {
    const host = new AgentKernelHost();

    expect(lastKernelOptions).toMatchObject({
      storageDir: '/tmp/finagent-test/store',
      piSessionDir: '/tmp/finagent-test/pi-sessions',
    });
    host.dispose();
  });

  it('hydrates sessions from the kernel', async () => {
    const host = new AgentKernelHost();

    await expect(host.hydrate()).resolves.toEqual({
      sessions: [expect.objectContaining({ id: 's1', title: 'Session A' })],
    });
    host.dispose();
  });

  it('creates sessions through the kernel', async () => {
    const host = new AgentKernelHost();

    await expect(host.createSession('My Session')).resolves.toMatchObject({
      id: 's-new',
      title: 'My Session',
    });
    host.dispose();
  });

  it('starts and cancels runs through the kernel', async () => {
    const host = new AgentKernelHost();

    await expect(host.startRun({ sessionId: 's1', content: 'AAPL.US quote' })).resolves.toMatchObject({
      id: 'r1',
      status: 'running',
      input: 'AAPL.US quote',
    });
    await expect(host.cancelRun({ sessionId: 's1', runId: 'r1' })).resolves.toBeUndefined();
    host.dispose();
  });

  it('rejects malformed run payloads', async () => {
    const host = new AgentKernelHost();

    await expect(host.startRun({ sessionId: '', content: 'x' })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    host.dispose();
  });

  it('forwards kernel agent events to the attached window', async () => {
    let subscriber: ((event: AgentEvent) => void) | null = null;
    fakeRuns.subscribe = (listener) => {
      subscriber = listener;
      return () => undefined;
    };
    const host = new AgentKernelHost();
    const window = {
      isDestroyed: () => false,
      webContents: { send: (channel: string, event: unknown) => forwardedEvents.push({ channel, event }) },
    };

    host.attach(window as never);
    const fn = subscriber as ((event: AgentEvent) => void) | null;
    fn?.({
      id: 'e1',
      sessionId: 's1',
      runId: 'r1',
      type: 'run_started',
      timestamp: 1,
      sequence: 1,
      payload: {
        run: { id: 'r1', sessionId: 's1', status: 'running', input: 'x', startedAt: 1 },
        userMessage: { id: 'm1', role: 'user', content: 'x', timestamp: 1 },
      },
    });

    expect(forwardedEvents).toHaveLength(1);
    expect(forwardedEvents[0]).toMatchObject({ channel: 'agent:event' });
    host.dispose();
  });

  it('routes market quotes through the shared market data service', async () => {
    const host = new AgentKernelHost();

    await expect(host.getQuote('aapl.us')).resolves.toMatchObject({
      symbol: 'AAPL.US',
    });
    expect(lastMarketData?.quoteSymbols).toEqual(['AAPL.US']);
    host.dispose();
  });

  it('wraps market data errors into IPC results', async () => {
    const host = new AgentKernelHost();
    const { toIpcResult } = await import('./kernelHost.ts');

    await expect(toIpcResult(() => host.getQuote(''))).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    });
    host.dispose();
  });
});
