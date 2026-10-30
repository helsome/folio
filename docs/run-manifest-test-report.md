# Run manifest acceptance report (#21)

## Evidence revision — read this first

The artifacts in `docs/acceptance/run-manifest/` were produced at revision
`402bd92f2c0b32dfed4b28b1038b67c2c0adf582`, when the acceptance script still injected an
**ad-hoc Yahoo chart fetcher plus the NYT Business RSS feed** through the capability-fetcher
seam.

`apps/electron/e2e/run-manifest-acceptance.ts` has since been switched to the **shipped**
retrieval path (`YahooChartFinancialDataProvider` → `ProviderRouter` → `createRouterFetchers`
→ `createFullRegistry`, the same wiring `AgentKernelHost` uses) — see *Limits* below. The
script now also asserts `search.providerId` / `search.routing` and records the answering
provider, timestamp and `delayed` flag per run.

**Those artifacts have not been regenerated.** Re-running the live acceptance needs a
DeepSeek API key, which was not available in the environment where this revision was
prepared. So:

- The two acceptance items proven below — the selective manifest diff, and the post-restart
  read-back that still reports the birth config — were measured on real runs and remain
  valid: neither depends on which retrieval source answered.
- The retrieval-source rows (`completedCapabilities` including `research.news`, and the
  provider-usage/wall-clock numbers) describe the **old** wiring. Under the new wiring
  `research.news` is `unavailable` (the shipped Yahoo adapter is market-data only), so a
  fresh run would report three completed capabilities, not four.
- Regenerating is a single command for anyone holding a key; the command is below.

## Acceptance environment

Date: 2026-09-29. Environment: Windows 11 Home China, NT 10.0.26200, Bun 1.4.2.
Validated revision: `402bd92f2c0b32dfed4b28b1038b67c2c0adf582` (this branch, `feat/run-manifest-21`).

## The two acceptance items

Issue #21 names two acceptance items that fixtures cannot satisfy:

1. **Two real production Deep Research runs**, with a deliberately changed config, whose
   manifest diff reflects exactly that change.
2. **A Run Info read-back after a restart** — a second, fresh process whose *current*
   globals name a different model — where the historical run must still report the config
   it was born with.

Both are proven below by `apps/electron/e2e/run-manifest-acceptance.ts`, which uses real
components only (no fixtures).

## Live two-run acceptance — PASS

Actual command, from the repository root, after loading the local DeepSeek key into the
process environment:

```sh
DEEPSEEK_API_KEY=... \
FINAGENT_ACCEPTANCE_APP_VERSION=0.5.0-acceptance \
FINAGENT_ACCEPTANCE_GIT_REVISION=402bd92f2c0b32dfed4b28b1038b67c2c0adf582 \
bun apps/electron/e2e/run-manifest-acceptance.ts
```

The parent orchestrator spawns three child processes: `run run-a`, `run run-b`, and
`inspect <runAId> deepseek-v4-pro`. Each child hosts the real `AgentKernel` and
`ResearchService` (the production research path), streams a real DeepSeek response, and
retrieves over the public internet through the shipped provider platform: the real
`YahooChartFinancialDataProvider` registered on a real `ProviderRouter`, whose fetchers are
handed to `createFullRegistry` — the same wiring `AgentKernelHost` uses. The capability
bodies — validation, sanitisation, summaries, provenance — run unchanged.

Deliberate config change between the two runs: **model** `deepseek-flash` → `deepseek-v4-pro`
and **budget** `modelCalls` 3 → 6. Everything else (strategy, prompt, tools, search config,
app/build version, git revision) is held constant.

| Evidence | Observed result |
| --- | --- |
| Run A id | research-e95ce1be-6eb9-479c-96dd-668d359c631e |
| Run B id | research-cec9f6d1-9be6-41fd-9932-4692906d36ba |
| Manifest run identity | manifest `runId` equals the research run id for both runs (trace identity is the run id, #14) |
| Run A requested vs manifest model | `deepseek-flash` = `deepseek-flash` |
| Run B requested vs manifest model | `deepseek-v4-pro` = `deepseek-v4-pro` |
| Run A budget | defaults/effective `{modelCalls: 3}`, `clamped: []` |
| Run B budget | defaults/effective `{modelCalls: 6}`, `clamped: []` |
| Strategy | `comprehensive @ 3637a33db7d9979cf55ad2331734b197b0db5ce665f65e2dcc2f57675b3fd076` (identical in both runs) |
| Prompt | `deep-research-synthesis@1`, hash `8105327b…bd9656f` (identical in both runs) |
| Tools | 20 enabled tools captured, identical in both runs |
| Completed capabilities | `market.quote`, `market.kline`, `company.profile`, `research.news` |
| Final status | `partial` — the 12 capabilities with no live equivalent are explicitly `unavailable`, never silently dropped |
| Run A provider usage | 6068 prompt + 5440 completion = 11508 tokens (128 cached, 3860 reasoning) |
| Run B provider usage | 6119 prompt + 3577 completion = 9696 tokens (384 cached, 2250 reasoning) |
| Wall clock | run A manifest written 17:37:26, run B 17:37:54, acceptance finished 17:38:43 → ≈1m18s |

The provider echoed the requested model back as `apiModel` for both runs, so the configured
model is demonstrably the model that ran — the manifest is not recording an intention.

## Two-run diff — PASS

`diffRunManifests(runA, runB)` (executed in the main process, never in the renderer) reports
exactly the deliberate change and nothing else:

```
changed = true
groups  = { model: true, prompt: false, tools: false, config: true, versions: false }
paths   = ["budget.defaults.modelCalls", "budget.effective.modelCalls", "model"]
model   : "deepseek-flash" -> "deepseek-v4-pro"
budget  : 3 -> 6
```

`prompt`, `tools` and `versions` stay `false` because those dimensions genuinely did not
change, which is the point: the diff is selective, not a blanket "something differs".

## Run Info after a restart — PASS

The third child is a **fresh process**. Its current globals name `deepseek-v4-pro`, but it
reads back the *historical* run A (born under `deepseek-flash`):

| Evidence | Observed result |
| --- | --- |
| Reading process | fresh process (simulated app restart) |
| Current global model in that process | `deepseek-v4-pro` |
| Historical manifest model | `deepseek-flash` |
| Historical run id | research-e95ce1be-6eb9-479c-96dd-668d359c631e |
| Preserved | `true` |

The manifest is append-only: the read-back process's different current globals do **not**
overwrite the historical run's record.

## Secret scan — PASS

The manifest schema has no credential field. `captureRunManifest` deep-copies and
redacts the snapshot **before it is persisted**, so the stored manifest, the IPC read
paths (`getRunManifest` / `getResearchManifest`) and `exportRunManifest` are all
credential-free by construction (#19, #21 review). Two independent checks agree:

- The acceptance scans the three real manifests it captured —
  `secretScan.apiKeyPresentInManifests` is computed from their serialised form, not
  hard-coded.
- A grep for the live API key across all eleven committed artifacts returns **0** matches.

## Committed artifacts

- [verification.json](acceptance/run-manifest/verification.json) — machine-readable result of every assertion above
- [Run A manifest](acceptance/run-manifest/run-a-manifest.json) / [Run B manifest](acceptance/run-manifest/run-b-manifest.json)
- [Run A JSON export](acceptance/run-manifest/run-a-manifest-export.json) — the redacted export the UI's "Export JSON" produces
- [Two-run diff](acceptance/run-manifest/manifest-diff.json)
- [Run Info after restart](acceptance/run-manifest/run-info-after-restart.json) — the fresh-process read-back payload
- [Provider usage Run A](acceptance/run-manifest/model-usage-run-a.json) / [Run B](acceptance/run-manifest/model-usage-run-b.json)
- [Run Info text](acceptance/run-manifest/run-info.txt)
- [Run Info view (HTML)](acceptance/run-manifest/run-info-after-restart.html)
- [Two-run compare view (HTML)](acceptance/run-manifest/run-info-compare.html)

The two HTML files are rendered by `apps/electron/e2e/render-run-info.ts` using the **shipped**
`ManifestView` / `DiffView` components from `packages/ui/src/components/kernel/RunInfoPanel.tsx`
via `renderToStaticMarkup`, with colours parsed out of the renderer's own `index.css` design
tokens. They are the view the app actually shows, not a re-implementation.

## Automated checks

Latest run (after rebasing onto `main` @ `9afa460` and adding the ordinary-read-path
redaction tests):

| Executed command | Result |
| --- | --- |
| `bun test --isolate packages/shared/src/research packages/shared/src/kernel packages/shared/src/evaluation packages/ui/src/components/kernel apps/electron/src/main/kernelHost.test.ts` | 497 pass / 1 fail; 2261 assertions across 41 files |
| `bun test --isolate apps/electron/src/main/kernelHost.test.ts` | 29 pass / 0 fail; 67 assertions |
| `bun node_modules/typescript/bin/tsc --noEmit` | exit 0 |
| `bun node_modules/typescript/bin/tsc --noEmit -p <tsconfig incl. apps/electron/e2e>` | exit 0 for this branch's two e2e scripts |

The single failure is `langfuse.test.ts > does not throw when Langfuse is down — agent path keeps
a diagnostic`. It is a **pre-existing local baseline failure**: it reproduces on a clean checkout
without this branch's changes (`git stash push -u`), and the file passes in CI. It is unrelated to
the manifest work.

The two e2e typecheck errors are `quote-provenance-live-acceptance.ts:192` (`payload` on a
union) and `research-recovery-kernel.ts:139` (`ReadableStream` async iteration). Both exist on
`main` and are untouched by this branch; the repository's root `tsconfig.json` only includes
`packages/*/src` and `apps/*/src`, so the `e2e/` directory is not typechecked in CI. This
branch's two new e2e scripts typecheck without error under the same settings.

## Limits

Retrieval goes through the **shipped** provider platform, not a hand-rolled substitute. The
acceptance registers the real `YahooChartFinancialDataProvider` on a real `ProviderRouter`,
points the routing at it, and hands `createRouterFetchers(router)` to `createFullRegistry` —
the same wiring `AgentKernelHost` uses. Consequences:

- The manifest records the provider and routing the run actually used: `search.providerId`
  and `search.routing` are read from `router.getRouting()`, and the script asserts them.
- Every result carries the answering provider, its timestamp and the `delayed` flag. Each
  run also re-probes a live quote through the same fetcher chain and stores
  `providerId` / `timestamp` / `delayed` in the artifact, so "real data came back" is
  evidenced rather than inferred from the wiring.
- Scope is exactly what the shipped adapter supports: US delayed quotes, daily/weekly
  candles and a thin company profile (`market.quote` / `market.kline` / `company.profile`).
  It is a no-key, **unofficial** chart endpoint — personal use, may rate-limit or change
  without notice (see `docs/yahoo-finance.md`).
- Everything else — broker positions and holdings, financials, news, options, intraday — has
  no provider on this machine. The router raises `UNSUPPORTED_CAPABILITY` and the run
  records those capabilities as `unavailable`; nothing is reported as zero or as "no
  events". That is why both runs finish `partial`.
- Longbridge is not installed here, but the in-scope market-data acceptance no longer
  depends on it: quotes, candles and the profile come from a provider that ships with the
  repository.

This acceptance exercises the kernel / research-service persistence path and the manifest
assembly. It does **not** run the Electron IPC layer or the desktop Pi adapter — the manifest
plumbing on that path is covered by the `kernelHost` unit tests instead. It is not a
packaging test.

The Run Info evidence is HTML, not a browser screenshot: this sandbox cannot launch a browser
or Electron (Mojo IPC channel creation and piped child-process creation both fail with access
denied / EPERM). Rendering the real components to static HTML is the closest faithful
substitute; it proves the view's content and layout but not pixel rendering in a live window.

No API key, authorization code, or other secret is committed. The DeepSeek key was read from
the local developer environment at run time and never written to any artifact.
