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
  current hosted runner setup has not established that prerequisite. Release must fail
  until it is available. No fake demo success is substituted.
- Independent review, Ready/merge decision, new beta.3 tag and complete prerelease.
  No tag or release was created by this task. No DMG/EXE success is claimed.
