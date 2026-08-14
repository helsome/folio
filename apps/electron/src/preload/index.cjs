var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toCommonJS = (from) => {
  var entry = (__moduleCache ??= new WeakMap).get(from), desc;
  if (entry)
    return entry;
  entry = __defProp({}, "__esModule", { value: true });
  if (from && typeof from === "object" || typeof from === "function") {
    for (var key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(entry, key))
        __defProp(entry, key, {
          get: __accessProp.bind(from, key),
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
        });
  }
  __moduleCache.set(from, entry);
  return entry;
};
var __moduleCache;

// src/preload/index.ts
var exports_preload = {};
module.exports = __toCommonJS(exports_preload);
var import_electron = require("electron");
var electronAPI = {
  window: {
    minimize: () => import_electron.ipcRenderer.invoke("window:minimize"),
    maximize: () => import_electron.ipcRenderer.invoke("window:maximize"),
    close: () => import_electron.ipcRenderer.invoke("window:close"),
    isMaximized: () => import_electron.ipcRenderer.invoke("window:isMaximized")
  },
  kernel: {
    hydrate: () => import_electron.ipcRenderer.invoke("kernel:hydrate"),
    createSession: (title) => import_electron.ipcRenderer.invoke("sessions:create", title),
    deleteSession: (sessionId) => import_electron.ipcRenderer.invoke("sessions:delete", sessionId),
    getMessages: (sessionId) => import_electron.ipcRenderer.invoke("sessions:getMessages", sessionId),
    listRuns: (sessionId) => import_electron.ipcRenderer.invoke("sessions:listRuns", sessionId),
    startRun: (input) => import_electron.ipcRenderer.invoke("runs:start", input),
    cancelRun: (input) => import_electron.ipcRenderer.invoke("runs:cancel", input),
    onAgentEvent: (callback) => {
      const listener = (_event, agentEvent) => callback(agentEvent);
      import_electron.ipcRenderer.on("agent:event", listener);
      return () => {
        import_electron.ipcRenderer.removeListener("agent:event", listener);
      };
    }
  },
  agent: {
    getTools: () => import_electron.ipcRenderer.invoke("agent:getTools")
  },
  market: {
    getQuote: (symbol) => import_electron.ipcRenderer.invoke("market:getQuote", symbol),
    getKline: (request) => import_electron.ipcRenderer.invoke("market:getKline", request),
    getPortfolio: () => import_electron.ipcRenderer.invoke("market:getPortfolio"),
    getStaticInfo: (symbol) => import_electron.ipcRenderer.invoke("market:getStaticInfo", symbol),
    getCalcIndex: (symbol) => import_electron.ipcRenderer.invoke("market:getCalcIndex", symbol),
    getMarketStatus: () => import_electron.ipcRenderer.invoke("market:getMarketStatus"),
    getNews: (symbol) => import_electron.ipcRenderer.invoke("market:getNews", symbol)
  },
  longbridge: {
    getStatus: () => import_electron.ipcRenderer.invoke("longbridge:getStatus")
  },
  alerts: {
    loadRules: () => import_electron.ipcRenderer.invoke("alerts:loadRules"),
    saveRules: (rules) => import_electron.ipcRenderer.invoke("alerts:saveRules", rules),
    listEvents: () => import_electron.ipcRenderer.invoke("alerts:listEvents"),
    onTriggered: (callback) => {
      const listener = (_event, payload) => callback(payload);
      import_electron.ipcRenderer.on("alerts:triggered", listener);
      return () => {
        import_electron.ipcRenderer.removeListener("alerts:triggered", listener);
      };
    }
  },
  capabilities: {
    list: () => import_electron.ipcRenderer.invoke("capabilities:list")
  },
  research: {
    start: (input) => import_electron.ipcRenderer.invoke("research:start", input),
    cancel: (input) => import_electron.ipcRenderer.invoke("research:cancel", input),
    listRuns: () => import_electron.ipcRenderer.invoke("research:listRuns"),
    getRun: (input) => import_electron.ipcRenderer.invoke("research:getRun", input),
    listReports: (input) => import_electron.ipcRenderer.invoke("research:listReports", input),
    getReport: (input) => import_electron.ipcRenderer.invoke("research:getReport", input),
    getDiff: (input) => import_electron.ipcRenderer.invoke("research:getDiff", input)
  },
  thesis: {
    list: (symbol) => import_electron.ipcRenderer.invoke("thesis:list", symbol),
    getReport: (symbol) => import_electron.ipcRenderer.invoke("thesis:getReport", symbol),
    saveFromReport: (symbol) => import_electron.ipcRenderer.invoke("thesis:saveFromReport", symbol),
    reEvaluate: (symbol) => import_electron.ipcRenderer.invoke("thesis:reEvaluate", symbol),
    update: (thesis) => import_electron.ipcRenderer.invoke("thesis:update", thesis),
    listImpacts: (symbol) => import_electron.ipcRenderer.invoke("thesis:listImpacts", symbol),
    onImpact: (callback) => {
      const listener = (_event, payload) => callback(payload);
      import_electron.ipcRenderer.on("thesis:impact", listener);
      return () => {
        import_electron.ipcRenderer.removeListener("thesis:impact", listener);
      };
    }
  },
  compare: {
    build: (symbols) => import_electron.ipcRenderer.invoke("compare:build", { symbols })
  },
  portfolioRisk: {
    analyze: () => import_electron.ipcRenderer.invoke("portfolioRisk:analyze")
  },
  llm: {
    getState: () => import_electron.ipcRenderer.invoke("llm:getState"),
    listModels: () => import_electron.ipcRenderer.invoke("llm:listModels"),
    setModel: (input) => import_electron.ipcRenderer.invoke("llm:setModel", input),
    listThinkingLevels: () => import_electron.ipcRenderer.invoke("llm:listThinkingLevels"),
    setThinkingLevel: (input) => import_electron.ipcRenderer.invoke("llm:setThinkingLevel", input),
    getProviders: () => import_electron.ipcRenderer.invoke("llm:getProviders"),
    listCredentials: () => import_electron.ipcRenderer.invoke("llm:listCredentials"),
    setCredential: (input) => import_electron.ipcRenderer.invoke("llm:setCredential", input),
    removeCredential: (input) => import_electron.ipcRenderer.invoke("llm:removeCredential", input),
    setCustomProvider: (input) => import_electron.ipcRenderer.invoke("llm:setCustomProvider", input),
    removeCustomProvider: (input) => import_electron.ipcRenderer.invoke("llm:removeCustomProvider", input),
    testProvider: (input) => import_electron.ipcRenderer.invoke("llm:testProvider", input)
  },
  skills: {
    list: () => import_electron.ipcRenderer.invoke("skills:list"),
    setEnabled: (input) => import_electron.ipcRenderer.invoke("skills:setEnabled", input),
    listResources: (skillId) => import_electron.ipcRenderer.invoke("skills:listResources", skillId),
    readResource: (skillId, relativePath) => import_electron.ipcRenderer.invoke("skills:readResource", skillId, relativePath),
    readiness: () => import_electron.ipcRenderer.invoke("skills:readiness")
  },
  about: {
    get: () => import_electron.ipcRenderer.invoke("app:about")
  },
  diagnostics: {
    collect: () => import_electron.ipcRenderer.invoke("diagnostics:collect"),
    export: () => import_electron.ipcRenderer.invoke("diagnostics:export")
  },
  health: {
    check: () => import_electron.ipcRenderer.invoke("health:check")
  },
  openExternal: (url) => import_electron.ipcRenderer.invoke("openExternal", url),
  connections: {
    list: () => import_electron.ipcRenderer.invoke("connections:list"),
    connect: (input) => import_electron.ipcRenderer.invoke("connections:connect", input),
    cancelConnect: (input) => import_electron.ipcRenderer.invoke("connections:cancelConnect", input),
    disconnect: (input) => import_electron.ipcRenderer.invoke("connections:disconnect", input),
    test: (input) => import_electron.ipcRenderer.invoke("connections:test", input),
    setConfig: (input) => import_electron.ipcRenderer.invoke("connections:setConfig", input),
    coverage: () => import_electron.ipcRenderer.invoke("connections:coverage"),
    onChanged: (callback) => {
      const listener = (_event, entries) => callback(entries);
      import_electron.ipcRenderer.on("connections:changed", listener);
      return () => {
        import_electron.ipcRenderer.removeListener("connections:changed", listener);
      };
    }
  },
  onboarding: {
    getCompleted: () => import_electron.ipcRenderer.invoke("onboarding:getCompleted"),
    setCompleted: (input) => import_electron.ipcRenderer.invoke("onboarding:setCompleted", input)
  },
  screening: {
    run: (input) => import_electron.ipcRenderer.invoke("screening:run", input),
    listRuns: () => import_electron.ipcRenderer.invoke("screening:listRuns"),
    getRun: (input) => import_electron.ipcRenderer.invoke("screening:getRun", input)
  },
  outcome: {
    listOpinions: (input) => import_electron.ipcRenderer.invoke("outcome:listOpinions", input),
    listOutcomes: (input) => import_electron.ipcRenderer.invoke("outcome:listOutcomes", input),
    evaluateDue: () => import_electron.ipcRenderer.invoke("outcome:evaluateDue")
  },
  portfolioImport: {
    parse: (input) => import_electron.ipcRenderer.invoke("import:parse", input),
    confirm: (input) => import_electron.ipcRenderer.invoke("import:confirm", input),
    listManual: () => import_electron.ipcRenderer.invoke("portfolio:listManual")
  },
  pulse: {
    snapshot: (input) => import_electron.ipcRenderer.invoke("pulse:snapshot", input)
  },
  performance: {
    skill: (input) => import_electron.ipcRenderer.invoke("performance:skill", input),
    strategy: (input) => import_electron.ipcRenderer.invoke("performance:strategy", input)
  },
  automation: {
    listRules: () => import_electron.ipcRenderer.invoke("automation:listRules"),
    saveRule: (input) => import_electron.ipcRenderer.invoke("automation:saveRule", input),
    removeRule: (input) => import_electron.ipcRenderer.invoke("automation:removeRule", input),
    runRule: (input) => import_electron.ipcRenderer.invoke("automation:runRule", input),
    listRuns: () => import_electron.ipcRenderer.invoke("automation:listRuns"),
    buildBrief: () => import_electron.ipcRenderer.invoke("automation:buildBrief"),
    onNotification: (callback) => {
      const listener = (_event, event) => callback(event);
      import_electron.ipcRenderer.on("notification:event", listener);
      return () => {
        import_electron.ipcRenderer.removeListener("notification:event", listener);
      };
    }
  },
  export: {
    markdown: (input) => import_electron.ipcRenderer.invoke("export:markdown", input),
    shareCard: (input) => import_electron.ipcRenderer.invoke("export:shareCard", input)
  }
};
import_electron.contextBridge.exposeInMainWorld("electronAPI", electronAPI);
