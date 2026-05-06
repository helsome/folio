# Finance Agent Backend Architecture Spec

## Summary

Finance Agent now uses a replaceable backend boundary instead of embedding chat intent, tool execution, and LongBridge calls directly in Electron main. The MVP backend is `LocalFinanceAgentBackend`; it is deterministic, session-aware, and uses `MarketDataService` for shared market data access. A future `PiRuntimeAgentBackend` can be added behind the same `AgentBackend` interface without changing renderer IPC.

## Current Architecture

```
Renderer ChatArea
  -> FinagentClient
  -> Electron preload IPC
  -> AgentGateway
  -> LocalFinanceAgentBackend
  -> IntentRouter / FinanceToolRegistry / MarketDataService
  -> longbridge-tools
  -> LongBridge CLI
```

`AgentGateway` remains in Electron main and owns IPC adaptation plus local alert JSON storage. It should not grow agent reasoning logic. New agent behavior belongs in `packages/shared/src/agent`.

## Public Interfaces

- `AgentBackend` exposes `getTools()` and `send(request)`.
- `AgentRequest` accepts `sessionId` and `content`.
- `AgentResponse` includes display `content`, optional `toolName`, structured `details`, `toolCalls`, and a session snapshot.
- `AgentBackendProvider` currently supports `local` and reserves `pi-runtime`.
- `FinagentClient.agent.send()` accepts either a string or an `AgentRequest`; UI should pass `{ sessionId, content }`.

## Implementation Rules

- Keep `packages/core` dependency-light and type-only.
- Keep `packages/ui` browser-safe; no Node, Electron, LongBridge, or shared business imports beyond public types/client contracts.
- Put deterministic agent behavior in `packages/shared/src/agent`.
- Put raw LongBridge CLI wrapping, parsing, validation, and error normalization in `packages/longbridge-tools`.
- Keep `packages/pi-extension` as Pi-compatible tool metadata/definitions for current tool listing and future runtime integration.

## Financial Behavior

- `IntentRouter` handles quote, K-line/chart, intraday, portfolio, and unsupported requests.
- Each session tracks recent symbols so follow-ups like `show chart` can reuse the last symbol.
- `MarketDataService` caches quote, kline, portfolio, intraday, and status lookups and coalesces same-key in-flight requests.
- K-line `limit` is applied locally after parsing; the LongBridge CLI does not receive an unsupported `--limit` flag.
- LongBridge parsers accept real CLI JSON shapes with string numeric fields.

## Test Expectations

- Shared backend tests cover routing, recent-symbol follow-ups, cache TTL, and request coalescing.
- Electron gateway tests cover IPC-to-backend adaptation and shared market service usage.
- UI atom tests cover session list/message metadata synchronization.
- LongBridge tests cover safe argv, error normalization, quote parsing, and kline parsing.
- Required verification before completion:
  - `bun run --cwd packages/ui test`
  - `bun run --cwd packages/shared test`
  - `bun run --cwd apps/electron test`
  - `bun run --cwd packages/longbridge-tools test`
  - `bun run typecheck`
  - `bun run build:electron`
