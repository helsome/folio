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
│  │  │   Window     │  │   Alert     │  │   Cache     │              │     │
│  │  │  Manager     │  │   Engine    │  │   Layer     │              │     │
│  │  └─────────────┘  └─────────────┘  └─────────────┘              │     │
│  └───────────────────────────────────────────────────────────────┘     │
│                               │ JSONL RPC (stdio)                     │
│  ┌───────────────────────────────────────────────────────────────┐     │
│  │                     PI AGENT BACKEND                            │     │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │     │
│  │  │    AI      │  │   Tools     │  │   Skills    │              │     │
│  │  │   Loop     │  │  Registry   │  │   Loader    │              │     │
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

### 2.2 Pi Agent Process

| Process | Language | Responsibility |
|---------|----------|----------------|
| **Pi Agent** | Node.js/TypeScript | AI conversation loop, tool execution |
| **Extension** | TypeScript | Custom tools (get_quote, get_kline, etc.) |

**Communication:**
- Main Process ↔ Pi Agent: JSONL RPC over stdio
- Pi Agent → LongBridge CLI: execa

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
│   ├── pi-extension/           # Pi Agent extension
│   │   └── src/
│   │       ├── index.ts         # Extension entry point
│   │       ├── tools/          # Tool registrations
│   │       │   ├── get-quote.ts
│   │       │   ├── get-kline.ts
│   │       │   ├── get-portfolio.ts
│   │       │   └── ...
│   │       ├── commands/        # Slash commands
│   │       └── events/          # Event handlers
│   │
│   └── longbridge-tools/       # LongBridge CLI wrapper
│       └── src/
│           ├── executor.ts       # Safe execa wrapper
│           ├── parser.ts         # JSON output parser
│           ├── validator.ts     # Symbol validation
│           └── cache.ts         # Response caching
│
└── apps/
    └── electron/                # Electron desktop app
        └── src/
            ├── main/             # Main process
            │   ├── index.ts      # Window management
            │   ├── ipc.ts        # IPC handlers
            │   ├── alert-engine.ts  # Background alert service
            │   └── tray.ts      # System tray
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

### 4.1 Quote Query Flow

```
User: "What's the price of TSLA?"
    ↓
InputBar sends message
    ↓
Pi Agent receives message
    ↓
AI decides to call get_quote tool
    ↓
pi-extension/get-quote.ts executes
    ↓
longbridge-tools/executor.ts calls CLI
    ↓
longbridge quote TSLA.US --format json
    ↓
JSON parsed and returned
    ↓
Pi Agent formats response
    ↓
Renderer displays QuoteCard
```

### 4.2 Alert Trigger Flow

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

### 7.1 Factory Pattern for Tools

```typescript
// packages/pi-extension/src/tools/base.ts
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: TSchema;
  execute: (params: any) => Promise<ToolResult>;
}

// Tool factory
export function createMarketTool(tool: ToolDefinition) {
  return {
    ...tool,
    beforeExecute: validateSymbol,
    execute: async (params) => {
      const result = await execLongBridge(tool.command, params);
      return tool.parser(result);
    },
  };
}
```

### 7.2 Cache Pattern

```typescript
// packages/longbridge-tools/src/cache.ts
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

class DataCache {
  private cache = new Map<string, CacheEntry<any>>();

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.timestamp + entry.ttl) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  set<T>(key: string, data: T, ttl: number): void {
    this.cache.set(key, { data, timestamp: Date.now(), ttl });
  }
}

// Cache strategies
const quoteCache = new DataCache();  // 30s TTL
const klineCache = new DataCache(); // 5min TTL
const portfolioCache = new DataCache(); // 2min TTL
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
2. Pi Agent continues running
3. Alert Engine continues monitoring
4. System notifications remain active

---

## 9. Extension Points

### 9.1 Adding New LongBridge Commands

1. Add to `packages/longbridge-tools/src/commands/`
2. Register tool in `packages/pi-extension/src/tools/`
3. Add UI component if needed in `packages/ui/`
4. Update PRD if feature is significant

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
| Portfolio data | 2-minute cache |
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
