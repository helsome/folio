# Finance Agent - System Architecture

## Overview

Folio is an AI-native finance workbench: a desktop application that combines a professional financial workspace (watchlist, security header, K-line charts, overview, financials, news) with a context-aware agent copilot. The agent layer is built on a persistent **Agent Kernel**: sessions, runs, and agent events are first-class entities owned by the main process, streamed to the UI over IPC, and persisted on disk so the app can be restarted without losing conversation state.

---

## 1. Architecture Overview

```
Workbench Shell (Allotment: Sidebar | Finance Workspace | Agent Panel)
      │
      ▼
Renderer atoms (view cache): activeSymbol / activeView / llmState
      │  IPC (whitelisted: kernel:*, sessions:*, runs:*, agent:*, market:*,
      │        llm:*, skills:*, alerts:*, longbridge:*)
      ▼
AgentKernelHost (main process)
      │
      ├── AgentKernel
      │     ├── SessionManager (persistence + lifecycle)
      │     ├── RunManager (run lifecycle + event broadcast)
      │     └── AgentRuntime
      │           ├── PiRuntimeAdapter ──► Pi Runtime (JSONL/stdio)
      │           │      ├── run → promptStreaming (workspace context + skill index)
      │           │      └── LlmRuntimeApi (listModels / setModel / thinking / test)
      │           └── LocalRuntimeAdapter (deterministic / tests)
      │
      ├── MarketDataService (UI + Agent share one data layer)
      ├── CredentialStore (safeStorage-encrypted, main process only)
      └── SkillHub V2 (SKILL.md packages + references, progressive loading)
      │
      ▼
AgentEvent Stream (run_started … run_completed)
      │
      ▼
Electron IPC ('agent:event' push channel)
      │
      ▼
React UI (Jotai atoms as view cache only)
```

The kernel runs in the Electron **main process**. The renderer never writes sessions, runs, or messages directly; it hydrates from the kernel and projects the event stream into Jotai state.

---

## 2. Process Architecture

| Process | Responsibility |
|---------|----------------|
| **Main Process** | `AgentKernel` (SessionManager + RunManager + runtime), IPC surface, market data, alerts |
| **Preload** | Whitelisted `contextBridge` API (`window.electronAPI`) |
| **Renderer** | React UI; subscribes to `agent:event`, calls kernel IPC (`sessions:*`, `runs:*`) |

Security boundary is unchanged and enforced:

```typescript
new BrowserWindow({
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    preload: path.join(__dirname, '../preload/index.cjs'),
  },
});
```

The renderer has no access to `fs`, `child_process`, the database, or the Pi runtime.

---

## 3. Domain Model

All types live in `@finagent/core`:

```
Session          ← persisted conversation scope (id, title, status, runtimeSessionPath, recentSymbols)
  ├── Messages   ← visible transcript (user / assistant), persisted per session
  └── Runs       ← one agent execution per user message
        └── AgentEvents ← unified event protocol (streamed, not persisted)
              └── ToolCalls ← live tool state inside events
```

### AgentEvent protocol

```ts
type AgentEvent =
  | run_started       { run, userMessage }
  | message_started
  | message_delta     { delta, answer }
  | message_completed { answer }
  | tool_started      { toolCall }
  | tool_completed    { toolCall }
  | run_completed     { answer, toolCalls }
  | run_failed        { error }
```

Every event carries `id`, `sessionId`, `runId`, `timestamp`, `sequence`. Pi-specific event shapes never cross the kernel boundary: raw Pi JSONL events are converted by `PiEventAdapter` in the `PiRuntimeAdapter`.

---

## 4. Agent Kernel

`packages/shared/src/kernel/`:

| Component | Responsibility |
|-----------|----------------|
| `SessionManager` | Create/list/delete sessions, persist messages, keep session metadata stats, assign each session a runtime session file path |
| `RunManager` | Start runs (persist user message + run record), drive the runtime event stream, broadcast events to subscribers, persist the final assistant message + run outcome, guarantee every run settles (completed / failed / cancelled) |
| `AgentKernel` | Composition root; owns `SessionManager`, `RunManager`, and the runtime adapter |

RunManager invariants:

- One run executes at a time (the Pi runtime processes one prompt at a time); a second `startRun` fails with `RUN_IN_PROGRESS`.
- `cancelRun` marks the run and calls `runtime.cancel()`; the run ends as `cancelled` (or `completed` if the runtime already finished).
- Timeouts, runtime crashes, tool failures, and malformed protocol output all end the run — no run can stay `running` forever.

### AgentRuntime abstraction

`@finagent/core` defines the provider-agnostic runtime contract:

```ts
interface AgentRuntime {
  getTools(): Promise<ApiResult<ToolDefinition[]>>;
  ensureSession({ id, title?, sessionPath?, recentSymbols? }): Promise<RuntimeSession>;
  run({ sessionId, runId, content, workspaceContext? }): AsyncIterable<AgentEvent>;
  cancel({ sessionId, runId }): Promise<void>;
  disposeSession?(sessionId): Promise<void>;
  dispose(): Promise<void>;
}
```

`workspaceContext` carries the renderer's current financial-object focus
(`activeSymbol`, `activeView`, `selectedPosition`) — the ephemeral Workspace
context, deliberately separate from Session (conversation) state. It is never
persisted.

## 5. Pi Runtime Adapter

`packages/shared/src/agent/`:

| Component | Responsibility |
|-----------|----------------|
| `PiRpcClient` | JSONL/stdio transport: `prompt`, `promptStreaming` (live raw events), `switchSession`, `getState`, `getAvailableModels`, `setModel`, `setThinkingLevel`, `restart`, `abortCurrentPrompt`, health checks, timeouts, process restart |
| `PiEventAdapter` | Pure Pi-event → AgentEvent mapping per run |
| `PiRuntimeAdapter` | `AgentRuntime` implementation: Folio session ↔ Pi session file lifecycle, prompt construction (workspace context + progressive skill index), symbol memory, and the `LlmRuntimeApi` control plane |

### Session isolation and recovery

Folio Session ↔ Pi conversation is a stable 1:1 mapping:

```
Folio Session A ──► <userData>/pi-sessions/<sessionA>.jsonl
Folio Session B ──► <userData>/pi-sessions/<sessionB>.jsonl
```

One Pi process is shared; the runtime switches conversations with the `switch_session` RPC command. The JSONL session file is Pi's own persistent conversation store, so:

- Session isolation: each Folio session has its own Pi session file — no cross-session context pollution.
- Resume: `switch_session` reloads the file, restoring the full conversation.
- Restart recovery: session files survive app restarts; `runtimeSessionId` is refreshed via `get_state` and stored on the Folio session.

### Event pipeline

```
Pi stdout (JSONL)                       tool_execution_start / tool_execution_end /
                                        message_update(text_delta) / agent_end / error
        │
        ▼
PiRpcClient.promptStreaming()           live raw events + aggregated result
        │
        ▼
PiEventAdapter.consume()                AgentEvent sequence (tool_started,
                                        message_delta, run_completed, …)
        │
        ▼
PiRuntimeAdapter.run()                  AsyncIterable<AgentEvent>
        │
        ▼
RunManager                              broadcast → IPC → UI; persistence
```

## 6. Local Runtime

`LocalRuntimeAdapter` wraps `LocalFinanceAgentBackend` in the `AgentRuntime` contract so the full session → run → event → UI loop works without a Pi process and in tests. Tool calls are replayed as start/end events from the backend's own records; cancellation is best-effort (applies when the current tool call settles). Session context (recent symbols) is persisted on the session and restored on restart.

## 7. Persistence

`packages/shared/src/storage/` — atomic JSON file store with repository abstractions (SQLite-swappable):

| Repository | File | Contents |
|------------|------|----------|
| `SessionRepository` | `sessions.json` | Session metadata index (`SessionMeta` incl. `messageCount`, `runtimeSessionPath`) |
| `MessageRepository` | `sessions/<id>/messages.json` | Visible transcript |
| `RunRepository` | `sessions/<id>/runs.json` | Run history |

Storage root: `<userData>/store`; Pi session files: `<userData>/pi-sessions`. Writes are atomic (tmp file + rename). The renderer never persists anything — Jotai atoms are a view cache hydrated from the kernel at startup.

## 8. IPC Surface

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `kernel:hydrate` | invoke | Session list on startup |
| `sessions:create` / `sessions:delete` | invoke | Session lifecycle |
| `sessions:getMessages` / `sessions:listRuns` | invoke | Lazy transcript / run history |
| `runs:start` (`{sessionId, content, workspaceContext?}`) / `runs:cancel` | invoke | Run lifecycle |
| `agent:event` | push | Live AgentEvent stream to the renderer |
| `agent:getTools` | invoke | Tool definitions |
| `market:getQuote` / `getKline` / `getPortfolio` / `getStaticInfo` / `getCalcIndex` / `getMarketStatus` / `getNews` | invoke | Market data (UI + Agent share this layer) |
| `llm:getState` / `listModels` / `setModel` / `listThinkingLevels` / `setThinkingLevel` | invoke | LLM control plane (Pi model registry) |
| `llm:getProviders` / `listCredentials` / `setCredential` / `removeCredential` | invoke | Provider status + credentials (secrets never cross IPC back to the renderer) |
| `llm:setCustomProvider` / `removeCustomProvider` / `testProvider` | invoke | OpenAI-compatible custom providers + connection tests |
| `skills:list` / `setEnabled` / `listResources` / `readResource` | invoke | SkillHub V2 surface |
| `longbridge:getStatus`, `alerts:load` / `alerts:save` | invoke | Status and alerts |

All handlers wrap results in the `{ ok, data | error }` envelope (`toIpcResult`).

## 9. State Management

- Sessions list: `sessionsAtom` (hydrated from kernel).
- Messages: `messagesAtomFamily` per session, loaded lazily from the kernel.
- Workspace context: `activeSymbolAtom` (single source of truth for the focused security), `activeViewAtom`, `navSectionAtom`, `agentPanelVisibleAtom`, derived `workspaceContextAtom` — UI-side Jotai state, distinct from session state.
- LLM control plane: `llmStateAtom` + `llmModelsAtom`/`llmProvidersAtom` view caches hydrated from the Pi registry through `llm:*` IPC.
- Runs: `runViewAtom` + `applyAgentEventAtom` reducer — a pure projection of the `agent:event` stream. `run_started` surfaces the user message; `tool_started`/`tool_completed` drive the live tool list; `message_delta` streams the answer; terminal events finalize the assistant message and clear the run view.
- The `KernelBridge` component hydrates on mount and subscribes to the event stream.

## 10. Security Architecture

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- IPC is whitelisted channel-by-channel in the preload (`index.ts` source, `index.cjs` runtime, built with `bun run build:preload`).
- **CredentialStore**: API keys and custom provider configs are encrypted at rest with Electron `safeStorage` (`<userData>/credentials.json`). The renderer sends secrets in once and only ever receives metadata back. Secret material is redacted from errors, logs, and traces (`redactSecrets`).
- Provider overrides flow main → Pi spawn env (`FINAGENT_PROVIDER_OVERRIDES`) → the finagent extension's `registerProvider` — Folio-owned config, never touching the user's global Pi config. Credential changes restart the Pi subprocess (sessions survive).
- LongBridge access stays behind `longbridge-tools` (parameterized execa array arguments, symbol validation).
- Skill resources are read through path-safe loaders (`SkillHub.readSkillResource` / `read_skill_resource` tool): absolute paths, `..` traversal, and symlink escapes are rejected.
- The renderer cannot reach `fs`, the database, the Pi process, or the LongBridge CLI directly.
---

## 11. Component Map

```
finagent/
├── packages/
│   ├── core/                  # Types only: capability/research/thesis/alert-rule/
│   │                          #   readiness/compare/portfolio-risk contracts +
│   │                          #   kernel types (Session, Run, AgentEvent, …)
│   ├── shared/
│   │   ├── providers/          # V4 provider platform: ProviderRouter (primary
│   │   │                      #   + fallback), registry, ConnectionStore,
│   │   │                      #   Longbridge financial-data + broker adapters,
│   │   │                      #   Massive (Polygon.io) fallback adapter, health
│   │   ├── diagnostics/        # Collector, redaction, support-bundle export,
│   │   │                      #   error ring buffer
│   │   ├── capabilities/      # Finance Capability Registry (single source of
│   │   │                      #   truth): manifests (phase-one + phase-two),
│   │   │                      #   registry, executor (concurrency/timeout/abort),
│   │   │                      #   Pi tool adapter, skill readiness
│   │   ├── research/          # Deep Research: planner, runner, synthesizers
│   │   │                      #   (agent-backed + deterministic local), repository
│   │   ├── thesis/            # InvestmentThesis: repository, converter,
│   │   │                      #   impact evaluators, service (re-evaluate)
│   │   ├── compare/           # Structured symbol comparison
│   │   ├── alerts/            # Alert Engine v2: rule repository (v1 migration),
│   │   │                      #   per-type evaluators, scheduler, event log
│   │   ├── portfolio-risk/    # Allocation/concentration/signals + synthesizer
│   │   ├── agent/             # PiRpcClient, adapters, LocalFinanceAgentBackend,
│   │   │                      #   FinanceToolRegistry (capability-backed), MarketDataService
│   │   ├── kernel/            # SessionManager, RunManager, AgentKernel
│   │   ├── resources/         # ResourceLocator (dev repo vs packaged resourcesPath)
│   │   └── storage/           # JsonFileStore, Session/Message/RunRepository
│   ├── ui/                    # React app: atoms (workspace/research/thesis/compare/
│   │   │                      #   portfolio-risk/alert/skill-readiness/…),
│   │   │                      #   layout, workspace, chart, agent, settings,
│   │   │                      #   research/thesis/compare/portfolio components, client
│   ├── pi-extension/          # Pi tools GENERATED from the capability registry
│   │                          #   (+ skill-resource tools) + provider overrides
│   ├── longbridge-tools/      # LongBridge CLI wrapper: 20+ fetchers, parsers,
│   │                          #   typed results, real-CLI test fixtures
│   └── skill-hub/             # SkillHub V2: SKILL.md packages + references,
│                              #   path safety, enable/disable, capability map
├── skills/                    # Vendored official Longbridge skills (MIT)
└── apps/electron/
    ├── src/
    │   ├── main/              # index.ts (IPC), kernelHost.ts (V3 wiring:
    │   │                      #   registry, services, alert engine, notifications),
    │   │                      #   credentialStore.ts, loadEnv.ts
    │   ├── preload/           # contextBridge API (source index.ts, built index.cjs)
    │   └── renderer/          # React entry, finagentClient
    └── e2e/                   # Golden-path A–H (run.mjs) + packaged smoke
```

## 11.1 Capability Layer (V4)

```
Longbridge CLI / Massive API ─► provider adapters (FinancialDataProvider,
                                   BrokerAccountProvider — neutral domains)
                                              │
                                    ProviderRouter (primary + fallback)
                                              │
                          ProviderResult { data, provenance{providerId, …} }
                                              │
                          Capability Registry (20 caps, router-backed fetchers)
                       ┌────────────────────┴──────────────────────┐
                       │                    │                       │
             Pi tools (generated)   UI availability +       Product workflows:
             via pi-extension        Skill Readiness          research / thesis /
                                                                alerts / compare /
                                                                portfolio risk
```

Each capability manifest declares id/name/description/category/risk/auth, a
TypeBox input schema, and an `execute` that returns `{ data, provenance,
summary }`. `defineCapability` wraps execute with input validation. The
`CapabilityExecutor` runs capabilities under timeout/abort with per-capability
failure isolation — research, re-evaluation, alerts, compare, and risk all
execute through it. All capabilities are read-only (`riskLevel: 'read'`); no
order/trading capability exists.

Business layers (research/agent/UI/portfolio/compare) never import a vendor
package: they consume capability results whose provenance names the actual
answering provider. Longbridge and Massive (Polygon.io, fallback) are the two
adapters in V4; the router is the only bridge (spec §4).

## 12. Data Flow — Workspace Query

```
User: clicks NVDA.US in the watchlist
    ↓
activeSymbolAtom = NVDA.US (single source of truth)
    ↓
SecurityHeader / Overview / Chart / News / AgentPanel context chip all follow
    ↓
User: "最近走势怎么样？" → AgentPanel input
    ↓
client.kernel.startRun(sessionId, content, workspaceContext)
    ↓
RunManager.startRun() → AgentRuntime.run({…, workspaceContext})
    ↓
PiRuntimeAdapter builds the prompt: workspace context + skill metadata index
    → Pi prompt (the agent loads relevant SKILL.md/references via
      read_skill_resource when needed)
    ↓
tool_started / tool_completed / message_delta … (AgentEvent stream)
    ↓
IPC 'agent:event' → KernelBridge → run reducer → ToolActivity + streaming answer
    ↓
run_completed (or run_failed / cancelled) → answer persisted to the transcript
```

App restart: `kernel:hydrate` restores the session list, `sessions:getMessages` restores transcripts, and Pi session files restore runtime conversation context (including the session's model and thinking level, via `get_state`).
