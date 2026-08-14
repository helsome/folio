# Folio V4 — Release Gates

Release pipeline: `internal` → `beta` → `stable`. V4 ships the first **Beta**
candidate. Gates are enforced by `bun run release:check` (or CI step) before a
tag may be cut. A build that fails ANY gate is `NOT RELEASEABLE` and must be
labeled as an internal/unsigned build (spec §38–40).

## Hard release blockers (any present → not Beta-ready, spec §64)

1. Portfolio corruption / garbled data (parser expecting wrong CLI shape,
   unnormalized numerics, raw vendor output in UI)
2. Skills interactions broken (click → nothing, silent IPC failures)
3. Onboarding cannot complete (clean install, no repo, no .env)
4. Provider cannot reconnect after disconnect/expiry
5. Secrets in logs, bundles, or diagnostics exports
6. White screen (uncaught renderer error outside an error boundary)
7. Packaged resources missing (skills, pi extension, renderer assets)
8. Provider status inaccurate (claims connected while auth broken)
9. Critical action silently fails (no feedback, no error)
10. `bun test`, `bun run typecheck`, or packaged smoke red

## Test tiers (window policy)

Every E2E harness launches the real Electron app **hidden** (`FINAGENT_E2E_HIDDEN=1`);
CDP keeps working while nothing appears on screen. `FINAGENT_E2E_VISIBLE=1`
forces the window on for manual debugging only.

| Tier | What runs | Launches Folio? | When |
|---|---|---|---|
| Dev | `bun test` (unit/integration), UI tests | never | every iteration |
| Local UI | Vitest/RTL-style component tests (bun test packages/ui) | never | every iteration |
| Integration gate | `test:e2e`, `test:interactions`, `test:skills-interactions` | hidden Electron | before commit |
| Release gate | `release:check` → package → `test:package-smoke`, `test:fresh-install` | hidden packaged Folio.app | once, at release |

All harnesses also self-clean stale instances on their CDP port before spawning,
so interrupted runs never leave zombie windows behind.

## Quality gates (run repeatedly, never only at the end, spec §69)

| Gate | Command | Required |
|---|---|---|
| Unit/integration | `bun test` | 0 fail |
| Typecheck | `bun run typecheck` | clean |
| Build | `bun run build` | clean (renderer + preload + main + extension) |
| Electron E2E | `FINAGENT_AGENT_PROVIDER=local bun run test:e2e` | golden path A–H green |
| Packaged smoke | `bun run test:package-smoke` | green (from outside repo) |
| Fresh-install E2E | clean `userData`, no repo, onboarding → workbench → quote → portfolio → skills → research → thesis → alert → restart | green |
| Interaction audit | Playwright button-contract suite | every control: behavior OR disabled OR removed |
| Provider smoke | connect Longbridge → status accurate → quote/kline/news/portfolio via router | green |
| Secret scan | no keys/tokens in artifacts or bundle | clean |

## Beta release gate (spec §70 final acceptance)

Simulate a real new user — no git repo, no `.env`, no terminal:

1. Install Beta → Welcome → accept privacy/disclaimer (one-time)
2. Connect AI (provider + credential + model + test)
3. Connect Longbridge (in-app flow; no shell)
4. Connection test passes; capability matrix shows real coverage
5. Health check: AI ✓ Market Data ✓ Skills ✓ Agent Runtime ✓
6. Enter Today → open NVDA → quote/chart render with freshness info
7. Deep Research → evidence report → save thesis
8. Portfolio renders: numbers, names (unicode), currencies, PnL — no NaN/
   undefined/[object Object]
9. Skills: disable Technical → state changes immediately → re-enable →
   state changes immediately → open detail → all controls functional
10. Quit → relaunch: connections, portfolio, skills, sessions, research,
    thesis all preserved

## Release channel / versioning

- SemVer in root `package.json` + `apps/electron/package.json`
- Channel in `apps/electron/package.json` (`folia.channel`):
  `internal` | `beta` | `stable`
- About view shows version + build (git SHA) + channel
- Tags: `vX.Y.Z-beta.N` → GitHub Release asset (DMG + checksums)

## Signing policy

- No Apple credentials → unsigned `internal` build, labeled NOT RELEASEABLE
- `beta`/`stable` channels REQUIRE signing + notarization configured in CI
  (secrets-gated); the pipeline must not emit a "release" without them.
