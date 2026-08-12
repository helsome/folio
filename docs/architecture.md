# Finance Agent - System Architecture

## Overview

Folio is a desktop application that combines an AI conversational interface with financial market data from LongBridge. The agent layer is built on a persistent **Agent Kernel**: sessions, runs, and agent events are first-class entities owned by the main process, streamed to the UI over IPC, and persisted on disk so the app can be restarted without losing conversation state.

---

## 1. Architecture Overview

```
Folio Session
      │
      ▼
SessionManager (persistence + lifecycle)
      │
      ▼
RunManager (run lifecycle + event broadcast)
      │
      ▼
AgentRuntime (provider-agnostic abstraction)
      │
      ├── PiRuntimeAdapter ──► Pi Runtime (JSONL/stdio)
      └── LocalRuntimeAdapter ─► LocalFinanceAgentBackend (deterministic / tests)
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
  run({ sessionId, runId, content }): AsyncIterable<AgentEvent>;
  cancel({ sessionId, runId }): Promise<void>;
  disposeSession?(sessionId): Promise<void>;
  dispose(): Promise<void>;
}
```

## 5. Pi Runtime Adapter

`packages/shared/src/agent/`:

| Component | Responsibility |
|-----------|----------------|
| `PiRpcClient` | JSONL/stdio transport: `prompt`, `promptStreaming` (live raw events), `switchSession`, `getState`, `abortCurrentPrompt`, health checks, timeouts, process restart |
| `PiEventAdapter` | Pure Pi-event → AgentEvent mapping per run |
| `PiRuntimeAdapter` | `AgentRuntime` implementation: Folio session ↔ Pi session file lifecycle, prompt construction, symbol memory |

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
| `runs:start` / `runs:cancel` | invoke | Run lifecycle |
| `agent:event` | push | Live AgentEvent stream to the renderer |
| `agent:getTools`, `market:*`, `longbridge:getStatus`, `alerts:*` | invoke | Market data and utilities (unchanged) |

All handlers wrap results in the `{ ok, data | error }` envelope (`toIpcResult`).

## 9. State Management

- Sessions list: `sessionsAtom` (hydrated from kernel).
- Messages: `messagesAtomFamily` per session, loaded lazily from the kernel.
- Runs: `runViewAtom` + `applyAgentEventAtom` reducer — a pure projection of the `agent:event` stream. `run_started` surfaces the user message; `tool_started`/`tool_completed` drive the live tool list; `message_delta` streams the answer; terminal events finalize the assistant message and clear the run view.
- The `KernelBridge` component hydrates on mount and subscribes to the event stream.

## 10. Security Architecture

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- IPC is whitelisted channel-by-channel in the preload (`index.ts` source, `index.cjs` runtime).
- LongBridge access stays behind `longbridge-tools` (parameterized execa array arguments, symbol validation).
- The renderer cannot reach `fs`, the database, the Pi process, or the LongBridge CLI directly.

---

## 11. Component Map

```
finagent/
├── packages/
│   ├── core/                  # Types only: Session, Message, Run, AgentEvent,
│   │                          #   ToolCall, RuntimeSession, AgentRuntime
│   ├── shared/
│   │   ├── agent/             # PiRpcClient, PiEventAdapter, PiRuntimeAdapter,
│   │   │                      #   LocalRuntimeAdapter, LocalFinanceAgentBackend,
│   │   │                      #   FinanceToolRegistry, MarketDataService
│   │   ├── kernel/            # SessionManager, RunManager, AgentKernel
│   │   └── storage/           # JsonFileStore, Session/Message/RunRepository
│   ├── ui/                    # React components, atoms, KernelBridge, client
│   ├── pi-extension/          # Pi tool metadata (registered into the Pi runtime)
│   ├── longbridge-tools/      # LongBridge CLI wrapper
│   └── skill-hub/             # Deferred (Phase 4+)
└── apps/electron/
    └── src/
        ├── main/              # index.ts (IPC), kernelHost.ts, loadEnv.ts
        ├── preload/           # contextBridge API
        └── renderer/          # React app, finagentClient
```

## 12. Data Flow — Chat Query

```
User: "分析一下我当前持仓最大的风险"
    ↓
ChatArea → client.kernel.startRun(sessionId, content)
    ↓
RunManager.startRun()
    ↓
persist run + user message → emit run_started
    ↓
AgentRuntime.run() → Pi/Local event stream
    ↓
tool_started / tool_completed / message_delta …
    ↓
IPC 'agent:event' → KernelBridge → run reducer → UI
    ↓
run_completed (or run_failed / cancelled)
    ↓
RunManager persists assistant message + run outcome
```

App restart: `kernel:hydrate` restores the session list, `sessions:getMessages` restores transcripts, and Pi session files restore runtime conversation context.
