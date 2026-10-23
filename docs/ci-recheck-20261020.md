# CI recheck — 2026-10-20

Work stays in `/workspace/folio-ci-release`, on the existing Draft PR #350 branch.
The default craft project and notification settings were not changed. No PR was
merged into main and no release/tag was created.

## Observed remote state

- Main: `7ddc3c65ec6327275821404dec3dda1485d1ae16`, containing merged Yahoo provider
  #353 and data-integrity fix #355. Synced both into #350 with a two-parent branch
  merge, preserving all prior CI/self-signing changes; there were no conflicts.
- Starting #350 head: `5e85d8e069d4f40aa6a98aa2cae622ecb28ac8ba`, still Draft.
- [PR checks page](https://github.com/helsome/folio/actions/workflows/pr.yml?query=event%3Apull_request)
  still showed Disabled. The shell's unauthenticated public API probe failed at
  CONNECT with 403 / HTTP status 000, and gh reported its existing GH_TOKEN invalid.
  This does not establish a GitHub-side Actions permission rejection: the API route
  remains proxy/transport blocked. No enable mutation was retried under unchanged
  conditions. No alternate identity, credential generation or permissions change.
- Latest actual failure inspected:
  [nightly run 39394619553](https://github.com/helsome/folio/actions/runs/39394619553),
  job `118534144958`, main SHA above. Logs show no registered model providers,
  missing model/judge credentials, Longbridge not installed, **exit 2 / zero cases**.
  It is blocked live preflight, not a failing test assertion or a completed benchmark.

## Concrete workflow repairs

The nightly had no CLI setup and passed `FINAGENT_ENV_FILE_CONTENT` without any
consumer loading it. Added the pinned Linux CLI setup to main-only schedule/manual
runs and an explicit live-mode environment allowlist. Nonempty direct env wins;
empty Actions secrets can use the existing dotenv values; missing values remain
missing. An Anthropic judge can use the same existing Anthropic credential.
No shell sourcing, secret/config mutation, OAuth login, generated service credential
or disk credential file is involved. Apple signing material and the raw dotenv blob
are removed before spawning the runtime. Demo substitution is rejected.

Nightly and manual offline eval now use the same tested Bun 1.4.2 as PR/release.
The actual nightly shell block creates the log directory, preserves CLI and logging
failure codes, and records validity for the summary. Exit 2 remains nonzero and is
labeled blocked/invalid; failures before the command show not executed. The schedule,
notification behavior, real live preflight, judge and release product gates remain.

## Executed validation

Environment: Linux x64, Bun 1.4.2, Node 24.19.0; frozen installation with
`ELECTRON_SKIP_BINARY_DOWNLOAD=1`. This enables non-GUI checks, not native app proof.

| Command | Actual result |
|---|---|
| synced tree, initial `bun test --isolate` | 2036 pass / 7 skip / 0 fail, 216 files |
| final `bun test --isolate` | **2042 pass / 7 skip / 0 fail**, 217 files |
| `bun test --isolate scripts/eval/environment.test.ts scripts/eval/workflow.test.ts scripts/eval/pipefail.test.ts scripts/release.test.ts` | **37 pass / 0 fail**, 117 assertions |
| Yahoo adapter / quoteAtoms / Watchlist focused files | **56 pass / 0 fail**, 206 assertions |
| `bun run typecheck` | core/i18n/shared/ui/electron all exit 0 |
| `bun run i18n:check` | en-US/zh-CN 1507 keys each, 0 issues |
| `bun run build` | packages/renderer/preload/main exit 0; existing chunk-size warning |
| `bun run eval:smoke -- --mode fixture --baseline folio-agent-v1 --store /tmp/folio-oct20-eval-store --out /tmp/folio-oct20-eval-fixture.json` | **15 fixture cases completed; baseline GATE: PASS** |
| changed workflow schema validation, Node syntax, secret scan, diff check | exit 0 |

The environment/pipe tests use fake credentials and a fixture CLI, including executing
**the extracted real nightly run block** with CLI exit 2: the shell exits 2, the output
records exit_code=2 and the log records no cases. This proves failure propagation,
not a live provider success. Fixture eval had no runtime model readback and no judge;
those dimensions remain unmeasured. Its temporary store avoids this sandbox's
read-only default home directory; no permission boundary was changed.

## Still blocked / unexecuted

- The changed workflows have not run on GitHub. PR checks still need enabling through
  an existing authorized GitHub UI/API route; this connector has no enable/dispatch.
- Actual existing secret availability and registered model readiness are unverified.
  If absent, the same real preflight must still reject the run. No secret was changed.
- Real macOS/Windows installer builds, ad-hoc/self-signature integrity/tamper checks,
  installation/startup, golden/v5 and release aggregation remain unexecuted.
- No claim of signed artifact, completed live evaluation or release readiness.
  #350 remains Draft for independent review and native Actions evidence.

## Exact main synchronization: f8b7809

At the parent's request, synchronized exact main
`f8b7809e3a816bf2111da7eb8e8977c8bb387fa4` (including #362/#342/#343/#347)
into the same #350 branch. The branch merge was conflict-free and retains the
previous nightly/release/self-signing repairs. It does not merge #350 into main.

Revalidation on the synchronized tree, same Linux/Bun/Node environment:

- `bun test --isolate`: **2057 pass / 7 skip / 0 fail**, 217 files, 8895 assertions.
- CI/release plus research-diff/retrieval/compare focused filters:
  **101 pass / 0 fail**, 9 files, 350 assertions.
- `bun test --isolate apps/electron/src/main/kernelHost.test.ts packages/shared/src/kernel/stream-event-log.test.ts packages/shared/src/research/runner.test.ts`:
  **35 pass / 0 fail**, 3 files, 151 assertions.
- `bun run typecheck`: core/i18n/shared/ui/electron all exit 0.
- `bun run build`: packages/renderer/preload/main exit 0; existing chunk warning.
- `bun run i18n:check`: 1507 keys per locale, 0 issues.
- Fixture eval smoke with baseline folio-agent-v1, temporary store
  `/tmp/folio-f8b-eval-store` and output `/tmp/folio-f8b-eval-fixture.json`:
  **15 offline cases completed, GATE: PASS**; not live/judge acceptance.
- Tracked-source secret scan and diff whitespace check passed.

The parent's logged-out browser independently confirms PR checks Disabled; no
additional API enable attempt, identity change or notification change was made.
Native Actions execution, installer/self-signature/live-provider acceptance and
independent CI-delta review remain outstanding. The PR stays Draft, with no tag,
release, or main merge performed by this thread.
