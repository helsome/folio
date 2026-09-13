# ADR 0001: Stream Event Protocol v1

- **Status:** Proposed (awaiting review on #27)
- **Date:** 2026-09-11
- **Deciders:** helsome/folio maintainers, contributor for #27

## Context

The Copilot answer path currently streams through an implicit `AgentEvent` protocol
(`packages/core/src/index.ts`): 8 event types
(`run_started / message_started / message_delta / message_completed / tool_started / tool_completed / run_completed / run_failed`)
carried over one IPC channel (`agent:event` in `apps/electron`). The envelope already has
`id / sessionId / runId / timestamp / sequence`, but the protocol lacks:

- a protocol version (no forward-compat contract);
- a monotonic `sequence` contract that all producers honor (idempotency / resume);
- an independent `cancelled` event (UI currently infers cancellation from `run_failed`);
- typed payloads for `tool_progress`, `citation_added`, and `status`.

Issue #27 asks for a stable, versioned streaming event protocol with cancel and
reconnect support.

## Decision

Introduce **Stream Event Protocol v1** as pure type/enum definitions in
`packages/core/src/stream-events.ts` (re-exported from `@finagent/core`). It is a
protocol-layer upgrade that coexists with `AgentEvent` during migration and
gradually replaces it.

### Envelope

```ts
interface StreamEventEnvelope<T extends StreamEventType> {
  protocolVersion: 1;   // forward-compat gate
  runId: string;        // one run = one generation (identity, see #34)
  messageId?: string;   // message-level events only: stable message id (#34);
                        // run-level events omit it. message and run are distinct identities
  sequence: number;     // monotonic per run; idempotency key = runId + sequence
  type: T;
  timestamp: string;    // ISO 8601 UTC; display only, never identity
  payload: StreamEventTypeToPayload[T];
}
```

Identity model (aligned with #34): a message has a stable id and can span
multiple runs (edit / regenerate / fork); an assistant generation binds to
exactly one run. Message-level events (`message_started / text_delta /
message_completed / cancelled`) carry the real assistant `messageId`; run-level
events (`run_started / run_completed / tool_* / citation_added / status /
error`) carry only `runId`. Implemented in `run-manager` (pre-assigned
assistant message id per run) and `stream-event-adapter`.

### Event types (12)

`run_started · message_started · text_delta · tool_started · tool_progress · tool_result ·
citation_added · status · error · cancelled · message_completed · run_completed`

Key behavior change: `message_delta` (full-answer snapshot) becomes `text_delta`
(incremental, append-only text).

### Cross-cutting contracts

| Capability | Contract |
|---|---|
| Idempotency | Consumers dedupe on `runId + sequence`; replayed events never re-insert text, tool cards, or citations |
| Cancel | renderer `cancelRun` → runtime propagates → runtime **explicitly emits `cancelled`**; partial answer preserved (`payload.partial.text` carries the text produced so far) |
| `run_failed` normalization | `RUN_CANCELLED` → `cancelled{reason:'user'}`; `BUDGET_EXHAUSTED` → `cancelled{reason:'budget'}`; `RETRY_STORM` / `LOOP_DETECTED` → `cancelled{reason:'runtime'}`; everything else → `error` (see `stream-event-adapter`) |
| Reconnect | **Implemented (v1, in-memory):** `RunManager.replayStream(runId, lastSequence)` returns the contiguous tail from `StreamEventHistory` (`packages/shared/src/kernel/stream-history.ts`); when the run is unknown or the tail is non-contiguous (buffer eviction), it returns `recoverable: false` — an explicit unrecoverable path the renderer must surface. IPC: `runs:stream-replay` |
| Final-state parity | UI `stopReason` and persisted `run.status` come from the same single final state in run-manager (aligns with #18) |
| Security (#19) | `status` never exposes chain-of-thought; tool payloads pass redaction before reaching the UI; renderer never executes model-returned code |

## Migration path

1. **Land types first (this ADR + `stream-events.ts`)**: zero runtime change, reviewable alone.
2. Runtime event loop (`run-manager`) emits the new typed events.
3. Transport upgrade (`kernelHost` + `preload`); renderer consumes the new protocol.
4. **Compat window**: keep `message_delta` as a "resume snapshot backfill" event —
   transport sends a full snapshot once after reconnect, then only `text_delta` increments.

## Consequences

- **Positive:** versioned contract; deterministic idempotency; explicit cancellation
  state; groundwork for reconnect/resume and for #21 immutable run manifests.
- **Negative:** dual event families during migration; consumers must handle both.
- **Open questions for reviewers:**
  1. Resume data source: v1 keeps events in memory (`StreamEventHistory`); persisting
     an event log is deferred (ties into #21 immutable run manifests) — acceptable?
  2. Is `status.phase` of `thinking / searching / working` sufficient?
  3. ~~Keep `messageId` merged with `runId`~~ **resolved**: #34 requires distinct
     message / run identities — envelope carries `messageId` only on message-level
     events (see Identity model above).