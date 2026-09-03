# Finance Agent - Coding Agent Instructions

This document provides guidance for AI coding agents working on the Finance Agent project.

---

## For Claude Code

When starting work on this project, Claude Code will automatically:
1. Load `CLAUDE.md` from the project root
2. Show project info via the session-start hook
3. Suggest loading required skills

**Required skills to use:**
- `pi-coding-agent` - For Pi Agent extension development
- `craft-agent-template` - For Electron + React architecture
- LongBridge skill - For data integration (install if needed)

---

## Skill System

Finance Agent uses a **Skill Hub** system for extensibility. Skills are loaded
from `SKILL.md` files (`<skillsDir>/<name>/SKILL.md`) with frontmatter
(name/keywords) and can be enabled/disabled; the choice persists to
`skills-state.json`. Marketplace and editor features are out of scope for V1.

The current agent path runs on the persistent **Agent Kernel** in the Electron
main process:

```
Renderer ChatArea
  -> FinagentClient (kernel.startRun / onAgentEvent)
  -> Electron preload IPC (runs:* / agent:event)
  -> AgentKernelHost -> AgentKernel
  -> RunManager -> AgentRuntime
     -> PiRuntimeAdapter (Pi JSONL/stdio) | LocalRuntimeAdapter
  -> FinanceToolRegistry / MarketDataService
  -> longbridge-tools
```

Sessions, runs, and messages are persisted by the kernel (JSON repositories
under `<userData>/store`); the renderer only hydrates from it and projects the
`agent:event` stream into Jotai. Do not put Node, Electron, or LongBridge
imports in `packages/ui`. UI code talks only through `FinagentClient`.

### Skill Types

| Type | Description | Example |
|------|-------------|---------|
| **Tool** | External command/API call | `get_quote`, `get_portfolio` |
| **Prompt** | Customizable prompt templates | `market_summary`, `stock_explain` |
| **Hybrid** | Tool + Prompt combination | `fundamental_analysis` |

### Adding a New Skill

1. **Define types** in `packages/core/src/index.ts` if the behavior changes the public contract.
2. **Add data access** in `packages/longbridge-tools` when a new LongBridge command is needed.
3. **Expose tool behavior** through `packages/shared/src/agent/FinanceToolRegistry`.
4. **Route user language** in `packages/shared/src/agent/intent-router.ts`.
5. **Register Pi-compatible metadata** in `packages/pi-extension` when the tool should appear in the tool list or future Pi runtime.
6. **Add UI** in `packages/ui` only through `FinagentClient`.

### Example: Adding a Tool Skill

```typescript
// packages/pi-extension/src/tools/get-kline.ts
pi.registerTool({
  name: "get_kline",
  label: "Get Kline",
  description: "Get candlestick/K-line data for a stock",
  parameters: Type.Object({
    symbol: Type.String({ description: "Stock symbol" }),
    period: Type.Optional(Type.String({ description: "Period: 1d, 1w, 1m" })),
  }),
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    const args = params.period ? ['kline', params.symbol, '--period', params.period] : ['kline', params.symbol];
    const output = await execLongBridge(args);
    return { content: [{ type: "text", text: formatKline(output) }] };
  },
});
```

### Example: Adding a Prompt Skill

Prompt Skills are stored as JSON and editable via UI:

```json
// packages/skill-hub/src/skills/market-summary/SKILL.json
{
  "id": "market-summary",
  "name": "市场概览",
  "type": "prompt",
  "trigger": {
    "keywords": ["市场", "概览", "大盘", "summary"]
  },
  "prompt": {
    "system": "你是一个专业的金融市场分析师。请用简洁易懂的语言总结市场动态。重点关注: 涨跌家数、成交量、北向资金等指标。"
  },
  "metadata": {
    "description": "生成市场概览摘要",
    "author": "finagent",
    "version": "1.0.0",
    "tags": ["market", "summary"],
    "enabled": true,
    "editable": true
  }
}
```

---

## Development Workflow

### 1. Before Starting Any Task

```bash
# Navigate to the project directory
cd folio

# Check git status
git status

# Review PRD for requirements
cat docs/PRD.md

# Review architecture
cat docs/architecture.md
```

### 2. Understanding Task Scope

For each task:
1. Read relevant sections in PRD
2. Check architecture document
3. Identify affected packages
4. Plan file changes

### 3. Implementation Pattern

Follow this pattern for any new feature:

```
1. Types (packages/core/src/index.ts)
   ↓
2. LongBridge wrapper or shared business logic
   ↓
3. Agent backend route/registry/composer
   ↓
4. Pi-compatible tool metadata, if needed
   ↓
5. UI component or atom, through FinagentClient
   ↓
6. Tests and Electron smoke
```

### 4. Code Template

#### LongBridge Tool Template

```typescript
// packages/longbridge-tools/src/tools/quote.ts
import { executeLongBridge } from '../executor.ts';
import { validateSymbolOrThrow } from '../validator.ts';
import type { Quote } from '@finagent/core';

export async function getQuote(symbol: string): Promise<Quote> {
  validateSymbolOrThrow(symbol);
  const output = await executeLongBridge(['quote', symbol, '--format', 'json']);
  return parseQuoteResponse(output);
}
```

#### Agent Backend Template

```typescript
// packages/shared/src/agent/finance-tool-registry.ts
if (input.name === 'get_quote') {
  const symbol = requireSymbol(input.args.symbol);
  const quote = await this.marketData.getQuote(symbol);
  return {
    content: [{ type: 'text', text: formatQuote(quote) }],
    details: quote,
  };
}
```

#### Pi Agent Extension Tool Template

```typescript
// packages/pi-extension/src/tools/get-quote.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { getQuote } from '@finagent/longbridge-tools';

export function registerGetQuoteTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "get_quote",
    label: "Get Quote",
    description: "Get real-time stock quote including price, change, and volume",
    parameters: Type.Object({
      symbol: Type.String({
        description: "Stock symbol (e.g., TSLA.US, 0700.HK)"
      }),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      try {
        const quote = await getQuote(params.symbol);
        const formatted = formatQuote(quote);
        return {
          content: [{ type: "text", text: formatted }],
          details: quote,
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    },
  });
}

function formatQuote(quote: Quote): string {
  const sign = quote.change >= 0 ? '+' : '';
  return `${quote.name} (${quote.symbol}): $${quote.price} (${sign}${quote.change} / ${sign}${(quote.changeRate * 100).toFixed(2)}%)`;
}
```

#### Electron IPC Handler Template

```typescript
// apps/electron/src/main/ipc.ts
import { ipcMain } from 'electron';
import { getQuote } from '@finagent/longbridge-tools';

export function registerMarketIpcHandlers() {
  ipcMain.handle('market:getQuote', async (_, symbol: string) => {
    try {
      const quote = await getQuote(symbol);
      return { success: true, data: quote };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}
```

#### Jotai Atom Template

```typescript
// apps/electron/src/renderer/atoms/market.ts
import { atom } from 'jotai';

// Quote cache atom
const quoteCacheAtom = atom<Map<string, Quote>>(new Map());

// Loading state
const quoteLoadingAtom = atom<Set<string>>(new Set());

// Derived atom for specific symbol
export const quoteAtomFamily = atomFamily((symbol: string) => {
  return atom((get) => {
    const cache = get(quoteCacheAtom);
    const loading = get(quoteLoadingAtom);
    return {
      quote: cache.get(symbol),
      isLoading: loading.has(symbol),
    };
  });
});
```

### 5. Testing Pattern

```typescript
// packages/longbridge-tools/src/executor.test.ts
import { describe, it, expect, vi } from 'vitest';
import { execLongBridge } from './executor';

describe('execLongBridge', () => {
  it('should parse quote output', async () => {
    // Mock execa to return test data
    vi.mock('execa', () => ({
      execa: vi.fn().mockResolvedValue({
        stdout: JSON.stringify({
          symbol: 'TEST.US',
          price: 100,
          change: 5,
        }),
        stderr: '',
      }),
    }));

    const result = await execLongBridge(['quote', 'TEST.US']);
    const data = JSON.parse(result);
    expect(data.symbol).toBe('TEST.US');
    expect(data.price).toBe(100);
  });
});
```

---

## Common Tasks

### Task: Add New Quote Field

1. **Update types** (`packages/core/src/index.ts`)
2. **Update parser** (`packages/longbridge-tools/src/parser.ts`)
3. **Update response formatting** (`packages/shared/src/agent/finance-tool-registry.ts`)
4. **Update UI** (`packages/ui/src/components/stock/QuoteCard.tsx`) if visual display changes

### Task: Add New LongBridge Command

1. **Add to API reference** (`docs/api-reference.md`)
2. **Create wrapper** (`packages/longbridge-tools/src/tools/`)
3. **Add parser and tests** (`packages/longbridge-tools/src/parser.ts`)
4. **Register in FinanceToolRegistry** (`packages/shared/src/agent/finance-tool-registry.ts`)
5. **Route language in IntentRouter** (`packages/shared/src/agent/intent-router.ts`)
6. **Register as Pi-compatible tool metadata** (`packages/pi-extension/src/tools/`) if needed
7. **Add UI component if needed**

### Task: Create New UI Component

1. **Create component** in `packages/ui/src/components/`
2. **Follow OKLCH theme** - use CSS variables
3. **Support dark mode** - test `.dark` class
4. **Export from index** - add to `packages/ui/src/index.ts`

---

## Security Checklist

For every change:

- [ ] Symbol validated before CLI execution?
- [ ] execa uses array parameters (no string concatenation)?
- [ ] Token stored in Keychain (not plain file)?
- [ ] Sensitive data logged?
- [ ] IPC channels whitelisted?

---

## Code Style Checklist

For every file:

- [ ] Under 400 lines?
- [ ] TypeScript strict mode?
- [ ] Type hints on all functions?
- [ ] Docstrings on public functions?
- [ ] Error handling with specific catch blocks?
- [ ] No hardcoded config values?

---

## Import Order

```typescript
// 1. React and hooks
import { useState, useEffect } from 'react';

// 2. External libraries
import { atom } from 'jotai';
import { execa } from 'execa';
import { clsx } from 'clsx';

// 3. Internal packages
import type { Quote } from '@finagent/core';
import { execLongBridge } from '@finagent/longbridge-tools';

// 4. Local components
import { Button } from '../ui';
```

---

## File Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Components | PascalCase | `QuoteCard.tsx` |
| Hooks | camelCase with `use` | `useQuote.ts` |
| Atoms | camelCase | `market.ts` |
| Utils | camelCase | `formatCurrency.ts` |
| Types | PascalCase | `Quote.ts` |
| Commands | kebab-case | `get-quote.ts` |

---

## Quick Reference

| Need Help With | Location |
|----------------|----------|
| LongBridge CLI | `docs/longbridge-skill-setup.md` |
| API commands | `docs/api-reference.md` |
| Architecture | `docs/architecture.md` |
| Pi Agent | `~/.claude/skills/pi-coding-agent/SKILL.md` |
| Electron pattern | `~/.claude/skills/craft-agent-template/SKILL.md` |

---

## Common Error Messages

| Error | Meaning | Solution |
|-------|---------|----------|
| `LONGBRIDGE_NOT_INSTALLED` | CLI not found | Run installation script |
| `LONGBRIDGE_NOT_AUTHED` | Not logged in | Run `longbridge auth login` |
| `LONGBRIDGE_TIMEOUT` | Command timed out | Retry |
| `INVALID_SYMBOL` | Bad symbol format | Check format (e.g., `TSLA.US`) |
| `RATE_LIMITED` | Too many requests | Wait and retry |

---

## Getting Help

If stuck:

1. **Check CLAUDE.md** - Main project config
2. **Review PRD** - `docs/PRD.md`
3. **Check architecture** - `docs/architecture.md`
4. **Use skills** - `pi-coding-agent`, `craft-agent-template`
5. **Ask for clarification** - Don't guess
