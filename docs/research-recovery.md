# Deep Research checkpoint recovery

ResearchService is the main-process owner of a run. Renderer reloads hydrate its durable state; they do not create another run. Electron takes a single-instance lock before constructing the kernel so two main processes cannot reconcile the same profile concurrently.

## Persistence and transitions

`userData/store/research/checkpoints/<runId>.json` is authoritative. Version 1 stores a SHA-256-checked JSON payload containing:

- original run id, symbol, strategy, locale, provider/model and a non-secret configuration fingerprint;
- frozen capability plan and inputs, outcomes including provenance and evidence run ids;
- synthesis and report when available;
- budget limits/usage, attempt counts and uncertain in-flight reads;
- recovery/step/synthesis/publication spans, original parent run id, and internal kernel session/run ids.

Each checkpoint is validated, written to a unique temporary file, flushed, then atomically renamed. POSIX also flushes the directory; Windows does not support directory fsync. This covers process termination, not a universal guarantee against every hardware/power failure. The summary and report indexes are projections. Startup discovers checkpoints independently of `runs.json` and repairs missing report/index files from terminal checkpoints.

Normal flow is `queued → fetching → synthesizing → completed | partial | failed | cancelled`. Startup changes unfinished runs to `interrupted`. Resume persists `recovering` under the same id before dispatching remaining work. Renderer recovery cards offer resume, restart with a new id, and discard. An explicit cancellation is durable and is never automatically resumed.

## Replay boundaries

Completed capability outcomes are reused exactly, including failures; resume does not silently refresh their data. Only reads without a durable outcome are retried. A request may have reached its provider before the process died: exactly-once remote reads are not possible, so these uncertain attempts remain charged and their retry counters increase. Capabilities with write risk are rejected before dispatch.

Synthesis gets the saved facts. The Pi extension disables all tools during that synthesis, including built-in shell/write tools, and restores the copilot tool set after the turn. An unfinished model request may be issued again; a saved synthesis/report is never regenerated. Production Pi synthesis failures become recoverable interruptions instead of falling back to fabricated success. LocalResearchSynthesizer remains available for explicit local mode/tests.

Publication upserts a stable `report-<runId>` and awaits idempotent report hooks before committing terminal status. Hook implementations must be idempotent by report id. Repeated resume calls are serialized; active or settled runs are no-ops. Evidence and section identities are validated to reject duplicates.

Provider/model/config identity must match both on resume and immediately before synthesis. Changed configuration requires restoring the original settings or restarting. Credentials themselves are not stored in checkpoints.

Budget counters survive recovery. Tool/model reservations are saved before dispatch and wall-clock includes downtime. The existing token/cost usage contract is preserved, but this change does not add provider token/cost metering; those fields are not billing evidence. Budget exhaustion cannot be bypassed by resuming.

Corrupt, unsupported-version or inconsistent checkpoints fail closed and remain untouched for diagnosis. Legacy summaries without checkpoints can be restarted/discarded but cannot honestly resume. A storage outage surfaces a failed in-memory diagnostic instead of leaving a dead worker in an endless loading state.

## Deterministic acceptance

From the repository root:

```sh
bun test --isolate packages/shared/src/research packages/ui/src/components/research packages/pi-extension/src --timeout 20000
```

`hard-kill.test.ts` starts an independent Bun process, waits for one saved result and one outstanding read, sends SIGKILL, and uses a fresh process to reconcile/resume the same run. It verifies preserved evidence, one report and attempt counts of 1 for the saved step and 2 for the uncertain step. Providers and synthesis in this test are fixtures; it is not the live acceptance required by issue #18.

## Live Electron acceptance

1. Install dependencies, build Electron and renderer, and install the official [Longbridge CLI](https://open.longbridge.com/docs/cli/install).
2. Create a separate test profile via `FINAGENT_USER_DATA_DIR`. In Folio Settings, configure and test a real model provider; select the model. Connect Longbridge and verify real news retrieval. Account registration, agreements, and authentication must be completed by the account owner.
3. Close that Folio instance. Run with the same profile, using Node and the built application:

```sh
FINAGENT_RECOVERY_USER_DATA=/absolute/path/to/test-profile \
  node apps/electron/e2e/research-recovery.mjs
```

PowerShell equivalent:

```powershell
$env:FINAGENT_RECOVERY_USER_DATA = 'C:\path\to\test-profile'
node apps/electron/e2e/research-recovery.mjs
```

Optional variables: `FINAGENT_RECOVERY_SYMBOL` (default NVDA.US), `FINAGENT_RECOVERY_OUTPUT` (default ignored e2e/artifacts/research-recovery).

The harness requires real news provenance and a model stream event linked to the checkpoint, kills Electron before synthesis is saved, relaunches, clicks the real Resume button, and verifies the same run id, unchanged saved outcomes/attempts, and a single report without duplicate evidence/sections. It writes before/after checkpoints, final report, screenshots, and `verification.json` with the kill point. It fails if these conditions are not reached; it does not substitute fixtures.

Current Massive adapter coverage is quote/K-line/company profile only, so configuring Massive alone cannot satisfy the news-retrieval assertion. A `partial` report is accepted only when real news/model work succeeded and other capability gaps are honestly represented.

The Electron/Pi desktop variant is not verified in the author environment: the Windows sandbox rejects Electron Mojo IPC and child-process pipes. The real headless kernel variant below has passed. These are distinct integration boundaries; the headless result does not imply the desktop harness passed.

## Live headless kernel acceptance

`apps/electron/e2e/research-recovery-kernel.ts` hosts the actual AgentKernel and ResearchService in a separate OS process. Its opt-in HTTP AgentRuntime uses real DeepSeek streaming, with no tools or local synthesis. News comes from Longbridge CLI by default. Only news is registered, so the final report is honestly partial for the other planned dimensions.

```sh
DEEPSEEK_API_KEY=<set-locally> FINAGENT_RECOVERY_OUTPUT=/absolute/fresh/artifact-dir \
  bun apps/electron/e2e/research-recovery-kernel.ts
```

`LONGBRIDGE_BIN` may point to an authenticated CLI. `FINAGENT_RECOVERY_MODEL` defaults to the accepted DeepSeek alias `deepseek-chat`; the tested API resolved it to `deepseek-flash`. The script rejects an already-used output directory.

When CLI credential storage is unavailable but the Longbridge MCP connector is authorized, `FINAGENT_RECOVERY_NEWS_RELAY=1` uses an external live relay: after `retrieval-request.json` appears, call Longbridge `news` for its symbol and write `retrieval-response.json` containing `{requestId, fetchedAt, data}`. Use the matching request id and the newly fetched article array, within the capability's 20-second timeout. The relay must call the real service after the request; do not substitute captured fixtures. This is the transport used in the attached evidence.

The parent observes the first actual model stream delta and its durable kernel run link, sends SIGKILL to the process hosting both kernel and workflow, then starts a fresh process. It verifies interruption, unchanged run id/outcomes/retrieval attempts, one additional synthesis attempt, and one report without duplicate sections/evidence. The committed [test report](research-recovery-test-report.md) links the before/after checkpoints, final report and verification record.

Checkpoints/reports may contain account data; keep raw artifacts local and review sensitive fields before sharing. The committed live evidence contains public NVDA news only, no portfolio data, credentials, or authorization codes.
