# CI/release validation — 2026-10-18

Working directory: independent `/workspace/folio-ci-release`; default
`craft-agents-oss` was not modified. No repository `AGENTS.md` or `.agents/skills`
exists at inspected main. Read CONTRIBUTING.md, CLAUDE.md, README build instructions,
release gates, current workflows, package/build configuration, tags and releases.

## Observed upstream evidence

- Fetched main: `ec0b8d2791f343495533a7425e6d3ecab97977b2`.
- [Live PR workflow page](https://github.com/helsome/folio/actions/workflows/pr.yml)
  explicitly showed **Disabled** on 2026-10-18. This explains current absent PR/push
  runs; a YAML edit alone cannot enable it. API workflow-state reads are unsupported
  by the connector and shell gh authentication failed. The exact disabling reason
  (`disabled_manually` vs another state) remains unverified.
- [Historical failed PR run](https://github.com/helsome/folio/actions/runs/36551172002),
  focused-test job `109349435319`: 1141 pass / 1 fail; research recovery
  `fails safely and preserves a version checkpoint` timed out with `Run did not settle`.
  Typecheck and full advisory jobs succeeded. This old failure does not establish a
  current main defect; current full and focused suites are independently checked below.
- [Today's nightly](https://github.com/helsome/folio/actions/runs/39110088747)
  is an external evaluation prerequisite failure (provider/runtime/Longbridge/judge),
  not evidence of a current unit-test assertion regression. No live evaluation success
  is claimed by this change.
- [Existing beta.2](https://github.com/helsome/folio/releases/tag/v0.4.0-beta.2)
  contains only an unsigned mac arm64 ZIP; beta.1 contains an arm64 DMG and checksum.
  Neither provides Intel DMG or Windows EXE. They will not be overwritten.
- Old release workflow used floating Bun + non-isolated tests, only a macOS runner,
  mac-only smoke, no fresh-install/v5 gates, and a presence-of-secrets signature claim.
  Packaging only collected DMG and invoked Unix `shasum`; first-launch paths were
  hardcoded to mac-arm64. These are concrete pipeline defects addressed here.

## Executed locally

Environment: Linux x64, Bun 1.4.2 (`744846f84`), Node 24.19.0 (Actions pin Node 22). Frozen dependencies installed
with `ELECTRON_SKIP_BINARY_DOWNLOAD=1` after the Electron postinstall download failed
with `EAI_AGAIN github.com`. This only enables unit/type/build validation; it does NOT
prove an Electron application or native installer starts.

| Command | Result |
|---|---|
| main baseline `bun test --isolate` | 1959 pass / 7 skip / 0 fail; 214 files |
| main baseline `bun run typecheck` | all five typecheck workspaces exit 0 |
| modified tree `bun test --isolate scripts/release.test.ts` | 8 pass / 0 fail; 17 assertions |
| modified tree `bun test --isolate` | 1967 pass / 7 skip / 0 fail; 215 files |
| modified tree `bun run typecheck` | all five typecheck workspaces exit 0 |
| `bun test packages/shared --isolate` | 1291 pass / 0 fail; 111 files (same focused scope as historical failure) |
| `bun run i18n:check` | en-US / zh-CN 1505 keys each, 0 issues |
| `bun run build` | UI + renderer + preload + main built; exit 0; existing chunk-size warning |
| `bun run build:extension` in apps/electron | finagent (688 modules), langsmith (186 modules) bundled; exit 0 |
| action-validator 0.6.0, three changed workflows | schema validation exit 0; paths-ignore glob validation unsupported warning |
| `git diff --check` | clean |

Regression tests cover version/tag mismatch, unsupported native targets, incomplete
and stale asset sets, checksum tampering, commit mismatch, missing/non-release smoke
evidence, false notarization claims, stale CDP port rejection and child-exit waiting.
Test installers are synthetic fixtures for manifest failure tests, never deliverable
installers. Product E2E assertions were retained rather than removed or made advisory.

## Still required (not executed / blocked)

- Real macOS arm64 DMG, Intel DMG, Windows x64 NSIS EXE builds and installed-app smoke
  on their native Actions runners. Linux unit/build success cannot replace these.
- Enable `pr.yml` and approve/run the Draft PR workflow using an existing authorized
  GitHub session. No shell push/dispatch or workflow-enable access is available here.
- Existing golden/v5 product gates require working real Longbridge capability data;
  trusted runner setup now installs the pinned CLI and probes the existing secret,
  but actual credential availability has not yet been established. Release must fail
  until it is available. No fake demo success is substituted.
- Independent review, Ready/merge decision, new beta.3 tag and complete prerelease.
  No tag or release was created by this task. No DMG/EXE success is claimed.

## Independent review follow-up: macOS framework symlinks

The Node copy operation previously rewrote relative framework symlinks to absolute
paths under the DMG mount. A Node subprocess regression fixture reproduced the
failure (8 pass / 1 fail), then passed after preserving links with
`verbatimSymlinks: true`. The fixture removes the entire source mount directory
before checking both unchanged link targets and reading the installed framework.

- `bun test --isolate scripts/release.test.ts`: 9 pass / 0 fail, 20 assertions.
- `bun test --isolate`: 1968 pass / 7 skip / 0 fail, 215 files.
- `node --check scripts/verify-installer.mjs`, source secret scan and diff check: clean.
- Native DMG mounting and application startup remain unexecuted pending Actions.

## Independent review follow-up: live prerequisites and optional signing

- Investigated the repository's auth/setup docs and official Longbridge v0.17.0 source
  at `e46c5f3ae8d3b80bd151a862b14c9cafc3eaf4ab`. Despite the OAuth-focused README,
  `src/openapi/context.rs` supports all three `LONGBRIDGE_*` API-key environment fields.
- Reused the existing `FINAGENT_ENV_FILE_CONTENT` secret name, passing it explicitly
  only from the trusted release caller. Parse only the three supported fields, perform
  a captured/sanitized read-only quote preflight, never create OAuth credentials.
- Added native job-local CLI installation pinned to v0.17.0 and digests from
  [official release assets](https://github.com/longbridge/longbridge-terminal/releases/expanded_assets/v0.17.0).
  PR/main/build-only runs do not install this dependency or receive vendor secrets.
- Restored the original five optional Apple secret names. Complete trusted credentials
  enable signing/notarization with output verification; no credentials means unsigned
  internal output, incomplete credentials or failed verification fail the job.
- Signed apps must pass code validation, Developer ID/team requirements, staple and
  Gatekeeper assessment both before staging and after DMG installation. Windows stays
  unsigned; publication remains an explicitly labeled internal prerelease.
- Availability of existing secret values, actual native CLI download, authenticated
  quote access and Apple verification remain **unexecuted** in this Linux environment.
  Secret inventory is not available through the connector; no values were inspected.

Follow-up local verification (same Linux/Bun/Node environment):

- `bun test --isolate scripts/release.test.ts`: **18 pass / 0 fail**, 55 assertions.
- `bun test --isolate`: **1977 pass / 7 skip / 0 fail**, 215 files.
- Node syntax checks for installer/provider/signing scripts, workflow schema validation,
  source secret scan and diff whitespace validation passed.
- Added tests for credential allowlisting/compartmentalization, missing-field error
  redaction, demo-mode rejection, read-only preflight, sanitized provider failures,
  explicit Apple opt-in, complete configuration, required verification commands,
  ad-hoc/team/notarization rejection, and signed-manifest validation evidence.
  Apple tests use synthetic command responses and do not claim real signing success.

## Final static review hardening

- Reproduced the Team ID prefix vulnerability: the old verifier accepted
  `TEAMFIXTURE2` when configured for `TEAMFIXTURE` (targeted regression failed).
  The verifier now captures codesign stdout/stderr without logging, parses exactly
  one `TeamIdentifier` and bundle `Identifier`, and requires full equality with the
  expected team and exactly parsed designated-requirement OU. Tests reject quoted
  and unquoted prefix matches, missing/duplicate fields and inconsistent identities.
- All five Apple secret expressions and signing opt-in now require
  `matrix.platform == 'darwin'`; Windows packaging receives no Apple secret values.
- Manual release documentation requires selecting the matching tag ref. The actual
  workflow preflight now rejects a branch at the identical SHA before git/API calls.
  Executed the extracted preflight script with mocked GitHub/git responses: same-SHA
  branch rejected, matching tag accepted. No workflow was dispatched.
- `bun test --isolate scripts/release.test.ts`: **20 pass / 0 fail**, 62 assertions.
- `bun test --isolate`: **1979 pass / 7 skip / 0 fail**, 215 files.
- Workflow schemas, Node syntax, secret scan and diff checks passed. Native evidence
  is still pending. PR remains Draft; no enable retry, tag or release was performed.
