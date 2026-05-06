# Finance Agent - System Architecture

## Overview

Finance Agent is a desktop application that combines AI conversational interface with financial market data from LongBridge. This document details the system architecture.

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ELECTRON LAYER                               │
│  ┌───────────────────────────────────────────────────────────────┐     │
│  │                     RENDERER PROCESS                          │     │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │     │
│  │  │  AppShell   │  │    Jotai   │  │   Tailwind  │            │     │
│  │  │   Layout    │  │    State   │  │   CSS v4    │            │     │
│  │  └─────────────┘  └─────────────┘  └─────────────┘            │     │
│  │                                                               │     │
│  │  ┌─────────────────────────────────────────────────────┐     │     │
│  │  │              React Components                          │     │     │
│  │  │  AppShell | TopBar | LeftSidebar | MainContent | RightPanel   │     │
│  │  └─────────────────────────────────────────────────────┘     │     │
│  └───────────────────────────────────────────────────────────────┘     │
│                               │ IPC (contextBridge)                   │
│  ┌───────────────────────────────────────────────────────────────┐     │
│  │                      MAIN PROCESS                               │     │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │     │
│  │  │   Window    │  │ AgentGateway│  │ Local JSON  │              │     │
│  │  │  Manager    │  │ IPC Adapter │  │  Storage    │              │     │
│  │  └─────────────┘  └──────┬──────┘  └─────────────┘              │     │
│  └───────────────────────────────────────────────────────────────┘     │
│                               │ shared package API                    │
│  ┌───────────────────────────────────────────────────────────────┐     │
│  │                  FINANCE AGENT BACKEND                          │     │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │     │
│  │  │AgentBackend │  │ Intent     │  │ Response    │              │     │
│  │  │  Factory    │  │ Router     │  │ Composer    │              │     │
│  │  └─────────────┘  └──────┬──────┘  └─────────────┘              │     │
│  │  ┌─────────────┐  ┌──────▼──────┐  ┌─────────────┐              │     │
│  │  │ Session     │  │ FinanceTool │  │ MarketData  │              │     │
│  │  │ Context     │  │ Registry    │  │ Service     │              │     │
│  │  └─────────────┘  └─────────────┘  └─────────────┘              │     │
│  └───────────────────────────────────────────────────────────────┘     │
│                               │ execa (safe)                         │
│  ┌───────────────────────────────────────────────────────────────┐     │
│  │                    LONGBRIDGE LAYER                              │     │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │     │
│  │  │    which    │  │   execa    │  │   parse     │              │     │
│  │  │  (检测)     │  │   (执行)    │  │   (解析)    │              │     │
│  │  └─────────────┘  └─────────────┘  └─────────────┘              │     │
│  └───────────────────────────────────────────────────────────────┘     │
│                               │                                     │
│                    ┌──────────┴──────────┐                          │
│              ┌─────┴─────┐        ┌─────┴─────┐                     │
│              │ longbridge│        │  Local    │                     │
│              │    CLI    │        │  Storage  │                     │
│              │ (用户安装) │        │ (JSON)    │                     │
│              └───────────┘        └───────────┘                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Process Architecture

### 2.1 Electron Processes

| Process | Language | Responsibility |
|---------|----------|----------------|
| **Main Process** | Node.js + TypeScript | Window management, native APIs, Alert engine |
| **Preload** | TypeScript | Secure IPC bridge (contextBridge) |
| **Renderer** | React + TypeScript | UI rendering, state management, user input |

### 2.2 Agent Backend

| Component | Language | Responsibility |
|-----------|----------|----------------|
| **AgentGateway** | Electron main + TypeScript | IPC adapter, ApiResult wrapping, local alert storage |
| **LocalFinanceAgentBackend** | TypeScript | MVP agent backend, deterministic intent routing, session context |
| **MarketDataService** | TypeScript | LongBridge access, TTL cache, in-flight request coalescing |
| **FinanceToolRegistry** | TypeScript | Tool metadata and tool execution boundary |
| **pi-extension** | TypeScript | Pi-compatible tool definitions and metadata |

**Communication:**
- Renderer ↔ Main Process: whitelisted IPC via preload.
- Main Process → Agent Backend: in-process `@finagent/shared` API.
- Agent Backend → LongBridge CLI: `longbridge-tools` using `execa` array arguments.
- Future Pi runtime: `AgentBackend` already supports a `pi-runtime` provider slot, but no JSONL/stdio process is launched in the MVP.

---

## 3. Module Design

### 3.1 Package Architecture

```
finagent/
├── packages/
│   ├── core/                    # Lightweight types only
│   │   └── src/
│   │       ├── types/          # Stock, Quote, Portfolio, Alert interfaces
│   │       └── utils/          # Pure utility functions
│   │
│   ├── shared/                 # Business logic
│   │   └── src/
│   │       ├── agent/          # AgentBackend, router, registry, market service
│   │       ├── config/         # Zod-validated configuration
│   │       ├── credentials/    # Token storage (Keychain)
│   │       └── sessions/       # Session management
│   │
│   ├── ui/                     # Shared React components
│   │   └── src/
│   │       ├── components/     # Primitives (Button, Input, Dialog)
│   │       │   └── ui/         # Radix-based primitives
│   │       ├── chat/           # Chat components (TurnCard, Message)
│   │       ├── stock/          # Stock-specific components (QuoteCard, KlineChart)
│   │       ├── styles/         # Tailwind CSS v4 + OKLCH theme
│   │       └── lib/             # cn() utility, layout constants
│   │
│   ├── pi-extension/           # Pi-compatible tool metadata
│   │   └── src/
│   │       ├── index.ts         # Extension entry point
│   │       ├── tools/          # Tool registrations
│   │       │   ├── get-quote.ts
│   │       │   ├── get-kline.ts
│   │       │   ├── get-portfolio.ts
│   │       │   └── ...
│   │
│   └── longbridge-tools/       # LongBridge CLI wrapper
│       └── src/
│           ├── executor.ts       # Safe execa wrapper
│           ├── parser.ts       # JSON output parser
│           ├── validator.ts    # Symbol validation
│           └── tools/          # quote/kline/portfolio wrappers
│
└── apps/
    └── electron/                # Electron desktop app
        └── src/
            ├── main/             # Main process
            │   ├── index.ts      # Window + IPC handler registration
            │   └── agentGateway.ts  # IPC-to-backend adapter
            │
            ├── preload/         # Preload scripts
            │   └── index.ts      # contextBridge API
            │
            └── renderer/       # React app
                ├── main.tsx     # React entry
                ├── App.tsx     # Root component
                ├── atoms/       # Jotai atoms
                │   ├── sessions.ts  # Session atoms
                │   ├── watchlist.ts # Watchlist atoms
                │   └── alerts.ts    # Alert atoms
                ├── components/     # App-specific components
                │   ├── app-shell/
                │   ├── chat/
                │   └── stock/
                └── styles/       # App-specific styles
```

---

## 4. Data Flow

### 4.1 Chat Quote Query Flow

```
User: "What's the price of TSLA?"
    ↓
ChatArea sends { sessionId, content }
    ↓
FinagentClient invokes agent:send through preload IPC
    ↓
AgentGateway forwards to LocalFinanceAgentBackend
    ↓
IntentRouter classifies quote and extracts TSLA.US
    ↓
FinanceToolRegistry calls MarketDataService.getQuote()
    ↓
MarketDataService cache/coalescing, then longbridge-tools executor
    ↓
longbridge quote TSLA.US --format json
    ↓
Parser normalizes JSON, ResponseComposer formats text
    ↓
Renderer appends assistant message
```

### 4.2 Follow-up Query Flow

```
User: "AAPL.US quote"
    ↓
LocalFinanceAgentBackend records AAPL.US in session.recentSymbols
    ↓
User: "show chart"
    ↓
IntentRouter uses the active session context to infer AAPL.US
    ↓
get_kline executes through the shared MarketDataService
```

### 4.3 Alert Trigger Flow

```
AlertEngine (every 60s)
    ↓
Check all active alerts
    ↓
For each alert, query current price
    ↓
Compare with threshold
    ↓
If triggered:
    ↓
Send system notification
    ↓
Mark alert as triggered
    ↓
Remove or keep alert (configurable)
```

---

## 5. State Management

### 5.1 Jotai Atoms

```typescript
// Session isolation - each session has its own state
const sessionAtomFamily = atomFamily((sessionId: string) => {
  return atom({
    id: sessionId,
    messages: [] as Message[],
    status: 'idle' as const,
    createdAt: Date.now(),
  });
});

// Global atoms - shared across all sessions
const watchlistAtom = atom<WatchlistItem[]>([]);
const alertsAtom = atom<Alert[]>([]);
const portfolioAtom = atom<Portfolio | null>(null);

// Active session tracking
const activeSessionIdAtom = atom<string | null>(null);
```

### 5.2 State Persistence

| Data | Storage | Notes |
|------|---------|-------|
| Sessions | JSON files | `~/.finagent/sessions/` |
| Watchlist | JSON | `~/.finagent/watchlist.json` |
| Alerts | JSON | `~/.finagent/alerts.json` |
| Settings | JSON | `~/.finagent/settings.json` |
| Token | Keychain | Never stored in plain files |

---

## 6. Security Architecture

### 6.1 Electron Security

```typescript
// Main process - BrowserWindow config
new BrowserWindow({
  webPreferences: {
    contextIsolation: true,    // Required
    nodeIntegration: false,     // Required
    sandbox: true,             // Required
    preload: path.join(__dirname, '../preload/index.js'),
  },
});
```

### 6.2 IPC Security

```typescript
// Preload - Whitelist channels
const validInvokeChannels = [
  'sessions:list',
  'sessions:create',
  'sessions:get',
  'alert:create',
  'alert:list',
  'alert:delete',
];

const validOnChannels = [
  'alert:triggered',
  'market:status',
];
```

### 6.3 LongBridge CLI Security

```typescript
// Symbol validation before execution
const ALLOWED_SYMBOL_PATTERN = /^[A-Z]{1,5}\.(US|HK|SG|SH|SZ|HAS)$/;

function validateSymbol(symbol: string): boolean {
  return ALLOWED_SYMBOL_PATTERN.test(symbol);
}

// Use execa array parameters - no shell injection
await execa('longbridge', ['quote', symbol, '--format', 'json']);
```

---

## 7. Key Design Patterns

### 7.1 Agent Backend Factory Pattern

```typescript
// packages/shared/src/agent/backend-factory.ts
export function createAgentBackend(options = {}): AgentBackend {
  const provider = options.provider ?? 'local';
  if (provider === 'local') {
    return new LocalFinanceAgentBackend();
  }
  throw new Error('Pi runtime backend is not wired yet. Use provider: local.');
}
```

### 7.2 Market Data Cache Pattern

```typescript
// packages/shared/src/agent/market-data-service.ts
await marketData.getQuote('AAPL.US');      // 30s TTL
await marketData.getKline({ symbol });     // 5min TTL
await marketData.getPortfolio();           // 60s TTL
```

---

## 8. System Tray Integration

### 8.1 Tray Features

| Feature | Description |
|---------|-------------|
| Show/Hide | Toggle window visibility |
| Status | Show market status (open/closed) |
| Alerts | Quick view of recent alerts |
| Quit | Exit application |

### 8.2 Background Running

When user clicks minimize to tray:
1. Window hides (not closed)
2. Agent backend remains in Electron main
3. Alert Engine continues monitoring
4. System notifications remain active

---

## 9. Extension Points

### 9.1 Adding New LongBridge Commands

1. Add a wrapper in `packages/longbridge-tools/src/tools/`
2. Add parser/error coverage in `packages/longbridge-tools/src/parser.ts` and tests
3. Expose the behavior through `packages/shared/src/agent/finance-tool-registry.ts`
4. Add intent routing in `packages/shared/src/agent/intent-router.ts`
5. Register Pi-compatible metadata in `packages/pi-extension/src/tools/` if the tool should be discoverable
6. Add UI through `FinagentClient` if needed

### 9.2 Adding New UI Components

1. Add to `packages/ui/src/components/`
2. Follow OKLCH color system
3. Support dark mode via `.dark` class
4. Use existing primitives (Button, Input, etc.)

---

## 10. Performance Considerations

| Aspect | Strategy |
|--------|----------|
| Quote data | 30-second cache |
| K-line data | 5-minute cache |
| Portfolio data | 60-second cache |
| In-flight market requests | Same-key requests share one Promise |
| Alert polling | 60-second interval |
| Session loading | Lazy load messages |

---

## 11. Error Handling

| Error Type | Handling |
|-------------|----------|
| LongBridge not installed | Show Setup Wizard |
| Not authenticated | Show auth prompt |
| Network error | Retry with exponential backoff |
| Invalid symbol | Show validation error |
| Rate limited | Queue and retry |
