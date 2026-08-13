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
    load: () => import_electron.ipcRenderer.invoke("alerts:load"),
    save: (alerts) => import_electron.ipcRenderer.invoke("alerts:save", alerts)
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
    readResource: (skillId, relativePath) => import_electron.ipcRenderer.invoke("skills:readResource", skillId, relativePath)
  }
};
import_electron.contextBridge.exposeInMainWorld("electronAPI", electronAPI);
