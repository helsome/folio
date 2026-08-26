import { app, BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions } from 'electron';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { AgentKernelHost, toIpcResult } from './kernelHost.ts';
import { registerAboutIpc } from './about.ts';
import { writeSupportBundle } from '@finagent/shared/diagnostics';
import { loadFinagentEnv } from './loadEnv.ts';
import { getRuntimeRoot } from '@finagent/shared/resources';
let mainWindow: BrowserWindow | null = null;
const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = join(__dirname, '../..');
if (app.isPackaged) {
  process.env.FINAGENT_PACKAGED = '1';
}
const runtimeRoot = getRuntimeRoot();

if (process.env.FINAGENT_USER_DATA_DIR) {
  app.setPath('userData', process.env.FINAGENT_USER_DATA_DIR);
}

loadFinagentEnv({
  roots: [runtimeRoot, appRoot],
});
const agentKernelHost = new AgentKernelHost();
registerAboutIpc();
const isDev = !app.isPackaged;

function createWindow() {
  // Test-harness window policy (see docs/release-gates.md §Test tiers):
  //   - default (real user): window is visible
  //   - FINAGENT_E2E_HIDDEN=1 (all e2e harnesses): window never appears on
  //     screen — CDP/renderer keep working, nothing flashes on the desktop
  //   - FINAGENT_E2E_VISIBLE=1 (manual debugging): force visible
  const windowVisible =
    process.env.FINAGENT_E2E_VISIBLE === '1' || process.env.FINAGENT_E2E_HIDDEN !== '1';
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    show: windowVisible,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Forward kernel agent events to the renderer.
  agentKernelHost.attach(mainWindow);

  // Load the app
  if (isDev && process.env.FINAGENT_FORCE_PROD_LOAD !== '1') {
    mainWindow.loadURL('http://localhost:5173');
    if (process.env.FINAGENT_OPEN_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools();
    }
  } else {
    mainWindow.loadFile(join(__dirname, '../../dist/renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  void agentKernelHost.dispose();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC handlers for window controls
ipcMain.handle('window:minimize', () => mainWindow?.minimize());

ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.handle('window:close', () => mainWindow?.close());

ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized());

// Agent Kernel IPC
ipcMain.handle('kernel:hydrate', async () =>
  toIpcResult(() => agentKernelHost.hydrate())
);

ipcMain.handle('sessions:create', async (_event, title: unknown) =>
  toIpcResult(() => agentKernelHost.createSession(title))
);

ipcMain.handle('sessions:delete', async (_event, sessionId: unknown) =>
  toIpcResult(() => agentKernelHost.deleteSession(sessionId))
);

ipcMain.handle('sessions:getMessages', async (_event, sessionId: unknown) =>
  toIpcResult(() => agentKernelHost.getMessages(sessionId))
);

ipcMain.handle('sessions:listRuns', async (_event, sessionId: unknown) =>
  toIpcResult(() => agentKernelHost.listRuns(sessionId))
);

ipcMain.handle('runs:start', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.startRun(input))
);

ipcMain.handle('runs:cancel', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.cancelRun(input))
);

ipcMain.handle('agent:getTools', async () =>
  toIpcResult(() => agentKernelHost.getTools())
);

ipcMain.handle('market:getQuote', async (_event, symbol: unknown) =>
  toIpcResult(() => agentKernelHost.getQuote(symbol))
);

ipcMain.handle('market:getKline', async (_event, request: unknown) =>
  toIpcResult(() => agentKernelHost.getKline(request))
);

ipcMain.handle('market:getPortfolio', async () =>
  toIpcResult(() => agentKernelHost.getPortfolio())
);

ipcMain.handle('market:getStaticInfo', async (_event, symbol: unknown) =>
  toIpcResult(() => agentKernelHost.getStaticInfo(symbol))
);

ipcMain.handle('market:getCalcIndex', async (_event, symbol: unknown) =>
  toIpcResult(() => agentKernelHost.getCalcIndex(symbol))
);

ipcMain.handle('market:getMarketStatus', async () =>
  toIpcResult(() => agentKernelHost.getMarketStatus())
);

ipcMain.handle('market:getNews', async (_event, symbol: unknown) =>
  toIpcResult(() => agentKernelHost.getNews(symbol))
);

ipcMain.handle('longbridge:getStatus', async () =>
  toIpcResult(() => agentKernelHost.getLongBridgeStatus())
);

// Folio V3: capabilities, skill readiness, research, thesis, compare, alerts, risk
ipcMain.handle('capabilities:list', async () =>
  toIpcResult(() => agentKernelHost.listCapabilities())
);

ipcMain.handle('skills:readiness', async () =>
  toIpcResult(() => agentKernelHost.listSkillReadiness())
);

ipcMain.handle('research:start', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.researchStart(input))
);

ipcMain.handle('research:cancel', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.researchCancel(input))
);

ipcMain.handle('research:listRuns', async () =>
  toIpcResult(() => agentKernelHost.researchListRuns())
);

ipcMain.handle('research:getRun', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.researchGetRun(input))
);

ipcMain.handle('research:listReports', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.researchListReports(input))
);

ipcMain.handle('research:getReport', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.researchGetReport(input))
);

ipcMain.handle('thesis:list', async (_event, symbol?: unknown) =>
  toIpcResult(() => agentKernelHost.thesisList(symbol))
);

ipcMain.handle('thesis:getReport', async (_event, symbol: unknown) =>
  toIpcResult(() => agentKernelHost.thesisGetReport(symbol))
);

ipcMain.handle('thesis:saveFromReport', async (_event, symbol: unknown) =>
  toIpcResult(() => agentKernelHost.thesisSaveFromReport(symbol))
);

ipcMain.handle('thesis:reEvaluate', async (_event, symbol: unknown) =>
  toIpcResult(() => agentKernelHost.thesisReEvaluate(symbol))
);

ipcMain.handle('thesis:update', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.thesisUpdate(input))
);

ipcMain.handle('thesis:listImpacts', async (_event, symbol: unknown) =>
  toIpcResult(() => agentKernelHost.thesisListImpacts(symbol))
);

ipcMain.handle('compare:build', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.compareBuild(input))
);

ipcMain.handle('portfolioRisk:analyze', async () =>
  toIpcResult(() => agentKernelHost.portfolioRiskAnalyze())
);

ipcMain.handle('alerts:loadRules', async () =>
  toIpcResult(() => agentKernelHost.loadAlertRules())
);

ipcMain.handle('alerts:saveRules', async (_event, rules: unknown) =>
  toIpcResult(() => agentKernelHost.saveAlertRules(rules))
);

ipcMain.handle('alerts:listEvents', async () =>
  toIpcResult(() => agentKernelHost.listAlertEvents())
);

// LLM control plane
ipcMain.handle('llm:getState', async () =>
  toIpcResult(() => agentKernelHost.getLlmState())
);

ipcMain.handle('llm:listModels', async () =>
  toIpcResult(() => agentKernelHost.listModels())
);

ipcMain.handle('llm:setModel', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.setModel(input))
);

ipcMain.handle('llm:listThinkingLevels', async () =>
  toIpcResult(() => agentKernelHost.listThinkingLevels())
);

ipcMain.handle('llm:setThinkingLevel', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.setThinkingLevel(input))
);

ipcMain.handle('llm:getProviders', async () =>
  toIpcResult(() => agentKernelHost.getProviders())
);

ipcMain.handle('llm:listCredentials', async () =>
  toIpcResult(() => agentKernelHost.listCredentials())
);

ipcMain.handle('llm:setCredential', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.setCredential(input))
);

ipcMain.handle('llm:removeCredential', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.removeCredential(input))
);

ipcMain.handle('llm:setCustomProvider', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.setCustomProvider(input))
);

ipcMain.handle('llm:removeCustomProvider', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.removeCustomProvider(input))
);

ipcMain.handle('llm:testProvider', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.testProvider(input))
);

// Skills
ipcMain.handle('skills:list', async () =>
  toIpcResult(() => agentKernelHost.listSkills())
);

ipcMain.handle('skills:setEnabled', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.setSkillEnabled(input))
);

ipcMain.handle('skills:listResources', async (_event, skillId: unknown) =>
  toIpcResult(() => agentKernelHost.listSkillResources(skillId))
);

ipcMain.handle('skills:readResource', async (_event, skillId: unknown, relativePath: unknown) =>
  toIpcResult(() => agentKernelHost.readSkillResource(skillId, relativePath))
);

ipcMain.handle('skills:installLocal', async () =>
  toIpcResult(async () => {
    const options: OpenDialogOptions = {
      title: 'Install Folio skill',
      properties: ['openDirectory'],
    };
    const selection = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (selection.canceled || selection.filePaths.length === 0) {
      return { canceled: true as const };
    }
    const installed = await agentKernelHost.installLocalSkillDirectory(selection.filePaths[0]);
    return { canceled: false as const, ...installed };
  })
);

ipcMain.handle('skills:remove', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.removeUserSkill(input))
);

// V7 Evaluation & observability (spec §61-68)
ipcMain.handle('evaluation:getSettings', async () =>
  toIpcResult(() => agentKernelHost.getEvaluationSettings())
);

ipcMain.handle('evaluation:setSettings', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.setEvaluationSettings(input))
);

ipcMain.handle('evaluation:setCredential', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.setEvaluationCredential(input))
);

ipcMain.handle('evaluation:removeCredential', async () =>
  toIpcResult(() => agentKernelHost.removeEvaluationCredential())
);

ipcMain.handle('evaluation:testConnection', async () =>
  toIpcResult(() => agentKernelHost.testEvaluationConnection())
);

ipcMain.handle('evaluation:listExperiments', async () =>
  toIpcResult(() => agentKernelHost.listEvaluationExperiments())
);

ipcMain.handle('evaluation:getExperiment', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.getEvaluationExperiment(input))
);

ipcMain.handle('evaluation:listBaselines', async () =>
  toIpcResult(() => agentKernelHost.listEvaluationBaselines())
);

ipcMain.handle('evaluation:getCase', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.getEvaluationCase(input))
);

ipcMain.handle('evaluation:submitFeedback', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.submitEvaluationFeedback(input))
);

ipcMain.handle('evaluation:listFeedback', async () =>
  toIpcResult(() => agentKernelHost.listEvaluationFeedback())
);

ipcMain.handle('evaluation:getTraceLink', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.getEvaluationTraceLink(input))
);

ipcMain.handle('evaluation:status', async () =>
  toIpcResult(() => agentKernelHost.getEvaluationStatus())
);

// Diagnostics (spec §35–36)
ipcMain.handle('diagnostics:collect', async () =>
  toIpcResult(() => agentKernelHost.collectDiagnostics())
);

ipcMain.handle('runtime:restart', async () =>
  toIpcResult(() => agentKernelHost.restartRuntime())
);

ipcMain.handle('diagnostics:export', async () =>
  toIpcResult(async () => {
    const bundle = await agentKernelHost.collectDiagnostics();
    const result = await dialog.showSaveDialog({
      title: 'Export Folio diagnostics',
      defaultPath: join(app.getPath('documents'), `folio-diagnostics-${Date.now()}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    await writeSupportBundle(bundle, result.filePath);
    return { canceled: false, filePath: result.filePath };
  })
);

// Environment health check (onboarding, spec §30)
ipcMain.handle('health:check', async () =>
  toIpcResult(() => agentKernelHost.checkHealth())
);

// Provider connections (spec §8–11)
ipcMain.handle('connections:list', async () =>
  toIpcResult(() => agentKernelHost.listConnections())
);

ipcMain.handle('connections:connect', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.connectProvider(input))
);

ipcMain.handle('connections:cancelConnect', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.cancelConnectProvider(input))
);

ipcMain.handle('connections:disconnect', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.disconnectProvider(input))
);

ipcMain.handle('connections:test', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.testProviderConnection(input))
);

ipcMain.handle('connections:setConfig', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.setProviderConfig(input))
);

ipcMain.handle('connections:coverage', async () =>
  toIpcResult(() => agentKernelHost.coverageMatrix())
);

ipcMain.handle('onboarding:getCompleted', async () =>
  toIpcResult(() => agentKernelHost.getOnboardingCompleted())
);

ipcMain.handle('onboarding:setCompleted', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.setOnboardingCompleted(input))
);

// V8: app preferences (locale) — main-owned so the renderer, agent runtime,
// notifications, and dialogs share one effective locale (spec §14–16).
ipcMain.handle('appPreferences:get', async () =>
  toIpcResult(() => agentKernelHost.getAppPreferences())
);

ipcMain.handle('appPreferences:update', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.updateAppPreferences(input))
);

// V5: screening / diff / outcome / import (spec §5–49)
ipcMain.handle('screening:run', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.screeningRun(input))
);

ipcMain.handle('screening:listRuns', async () =>
  toIpcResult(() => agentKernelHost.screeningListRuns())
);

ipcMain.handle('screening:getRun', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.screeningGetRun(input))
);

ipcMain.handle('research:getDiff', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.researchGetDiff(input))
);

ipcMain.handle('outcome:listOpinions', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.outcomeListOpinions(input))
);

ipcMain.handle('outcome:listOutcomes', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.outcomeListOutcomes(input))
);

ipcMain.handle('outcome:evaluateDue', async () =>
  toIpcResult(() => agentKernelHost.outcomeEvaluateDue())
);

ipcMain.handle('import:parse', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.importParse(input))
);

ipcMain.handle('import:confirm', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.importConfirm(input))
);

ipcMain.handle('portfolio:listManual', async () =>
  toIpcResult(() => agentKernelHost.listManualPortfolios())
);

// V5 Phase 2: pulse / performance / automation / export
ipcMain.handle('pulse:snapshot', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.pulseSnapshot(input))
);

ipcMain.handle('performance:skill', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.performanceSkillPerformance(input))
);

ipcMain.handle('performance:strategy', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.performanceStrategyPerformance(input))
);

ipcMain.handle('performance:calibration', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.performanceSkillCalibration(input))
);

ipcMain.handle('performance:strategyCalibration', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.performanceStrategyCalibration(input))
);

ipcMain.handle('automation:listRules', async () =>
  toIpcResult(() => agentKernelHost.automationListRules())
);

ipcMain.handle('automation:saveRule', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.automationSaveRule(input))
);

ipcMain.handle('automation:removeRule', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.automationRemoveRule(input))
);

ipcMain.handle('automation:runRule', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.automationRunRule(input))
);

ipcMain.handle('automation:listRuns', async () =>
  toIpcResult(() => agentKernelHost.automationListRuns())
);

ipcMain.handle('automation:buildBrief', async () =>
  toIpcResult(() => agentKernelHost.automationBuildBrief())
);

ipcMain.handle('export:markdown', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.exportMarkdown(input))
);

ipcMain.handle('export:shareCard', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.exportShareCard(input))
);

// Controlled external open (spec §10): http/https only, never a shell.
ipcMain.handle('openExternal', async (_event, url: unknown) =>
  toIpcResult(async () => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      throw new Error('Only http(s) URLs may be opened');
    }
    await shell.openExternal(url);
  })
);
