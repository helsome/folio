# V5 Blocker Sweep — Audit Report

Sweep of the V4 hard-release blockers (spec §64 / docs/release-gates.md) against the
V5 working tree. Read-only except ONE P0 fix (see §8). No Electron was launched;
e2e harnesses were not touched (TestInfra owns them).

## 1. Audit table

| # | Area | Check | Result | Evidence |
|---|---|---|---|---|
| 1 | Portfolio corruption | `bun test packages/longbridge-tools packages/shared packages/ui` | GREEN (606 pass; 2 pre-existing V5 in-flight failures, see §6) | Test run 2026-08-14; normalizer/money review below |
| 1a | Portfolio corruption | `packages/ui/src/lib/money.ts` NaN/raw risk | GREEN | `formatMoney`/`formatSignedMoney`/`formatPercent`/`formatQuantity` all guard `!Number.isFinite` → `'—'` (money.ts:8-33) |
| 1b | Portfolio corruption | `packages/ui/src/lib/portfolioFailure.ts` raw-output risk | GREEN | IPC error envelope → stable code map (`CODE_KINDS`); raw vendor messages never rendered (portfolioFailure.ts:17-44) |
| 1c | Portfolio corruption | normalizer numeric coercion | GREEN | `toFiniteNumber` never returns NaN (`Number.isFinite` guarded, normalizer.ts:106-114); `normalizeHolding`/`normalizeAccount`/`normalizeAssets`/`normalizeCashFlow` all coercion-safe; portfolio parse errors put raw output in `LongBridgeError.debug`, never message (parser.ts:109-116) |
| 2 | Skills broken UI | `SkillsView.tsx` / `SkillToggle` / `useSkillToggle` silent-failure paths | GREEN | No empty `catch{}` in `packages/ui/src/components/settings/`; `useSkillToggle` rolls back + surfaces `toggleError` (useSkillToggle.ts:44-54); `SkillRow` renders it as `role="alert"` (SkillRow.tsx:64-69); `SkillsView` has loading/error/empty + Retry (SkillsView.tsx:96-125); drawer surfaces `resourcesError`/`contentError`/per-doc error (SkillDetailDrawer.tsx:298-327, 382-384) |
| 3 | Provider connection | longbridge/massive error paths leak raw CLI/HTTP output | GREEN (+P0 fixed, see §8) | `toProviderError` maps every `LongBridgeError` code to user-safe text (longbridge/adapter.ts:62-96); Massive maps HTTP status → user-safe `ProviderError`, network errors → generic (massive/adapter.ts:299-315, 200-216); executor drops stderr (only `debug`), longbridge-tools/errors.ts:12-13; `toIpcError` redacts secrets (kernelHost.ts:1185-1202) |
| 3a | Provider connection | `connections.ts` client loader degrades gracefully | GREEN | Channel absent → `[]`/`null`/no-op unsubscribe; failures → catch returns empty (connections.ts:104-113, 122-129, 139-145); actions return `ConnectionActionResult` with surfaced error |
| 4 | Onboarding | fresh user stuck paths; main-process completion flag | GREEN (1 concern, see §6) | `shouldShowOnboarding` gate waits on `checked` + `mainFlagLoaded` (OnboardingOverlay.tsx:83); both effects have `.finally` so a failure cannot hang the gate (OnboardingOverlay.tsx:26-66); wizard has Skip on every step (OnboardingWizard.tsx:120); `getOnboardingCompleted` reads `userData/onboarding.json` (kernelHost.ts:1054-1058), wired `onboarding:getCompleted`/`onboarding:setCompleted` (index.ts:363-369) |
| 5 | Release | `scripts/release-check.mjs` gate completeness | GREEN | 7 gates: unit tests, typecheck, build, e2e (local), package, packaged smoke, fresh-install (release-check.mjs:24-63) |
| 5a | Release | `.gitignore` covers e2e/.user-data* | GREEN | `.gitignore` lines: `apps/electron/e2e/.user-data`, `.user-data-interactions`, `.user-data*`; no tracked `.user-data` files (`git ls-files` clean) |
| 5b | Release | CI gate completeness | CONCERN (info) | `.github/workflows/release.yml` runs 6 of the 7 gates inline but skips `test:fresh-install`; docs list "interaction audit" and "secret scan" as quality gates that are not mechanically enforced in release-check/CI |
| 6 | Secrets | committed keys/tokens scan | GREEN | Only fake values in `redact.test.ts` / `credentialStore.test.ts` (e.g. `sk-test-secret-value-123`, `AKIAIOSFODNN7EXAMPLE`, `ghp_abcdef…`); no `.env`/`.pem`/`.key` tracked; fixture account commands gitignored (`positions.json` etc.); only sanitized `*.sample` fixtures tracked; no 40+ char alnum strings in tracked non-test files |

## 2. P0 fixed (spec §64 blocker #1 — raw vendor output in UI)

**Finding:** 16 non-portfolio parsers in `packages/longbridge-tools/src/parser.ts` embedded
the FULL raw CLI stdout in the `LongBridgeError` message:

```ts
throw new LongBridgeError(`Failed to parse quote response: ${output}`, 'LONGBRIDGE_PARSE_FAILURE');
```

The golden path (`market:getQuote` etc.) runs `MarketDataService` (packages/shared/src/agent/
market-data-service.ts:73-88) which calls longbridge-tools DIRECTLY — bypassing the router's
user-safe `toProviderError` wrapper. The LongBridgeError crossed IPC via `toIpcError`
(kernelHost.ts:1185-1202, `isCodeError` accepts any Error with a string `code`) and was
rendered verbatim in the UI: `SecurityHeader.tsx:114` (`Quote unavailable: {error}`),
`NewsView.tsx:77` (`News unavailable: {error}`), and quote-cache error state
(atoms/quoteAtoms.ts:74-84). Trigger: CLI exits 0 with non-JSON stdout (HTML error page,
plain-text rate-limit/auth-expiry banner) — exactly the states a fresh/expired user hits.

**Fix (minimal, at the source):** added `parseFailure(what, output)` in parser.ts:99-107 —
user-safe message, raw output truncated to 2000 chars in `LongBridgeError.debug` (same
convention as the existing `parsePortfolioError`, parser.ts:109-116). Replaced all 16 sites
(quote, kline, intraday, static info, calc-index, market-status, news, depth, trades,
capital flow, market-temp, financial-report, institution-rating, dividend, forecast-eps,
finance-calendar). Confirmed zero remaining `${output}` interpolations in packages/ or apps/.

**Files changed:**
- `packages/longbridge-tools/src/parser.ts` — helper + 16 replacements
- `packages/longbridge-tools/src/longbridge-tools.test.ts` — regression test
  ("never leaks raw CLI output into parse-failure messages", asserts message clean + debug
  carries the output across 6 parser families)

**Verification:** `bun test packages/longbridge-tools` → 65 pass / 0 fail (was 64 before +
1 new); `bunx tsc --noEmit -p packages/longbridge-tools` clean. Re-ran the three sweep
packages: 606 pass (see §7 for the 2 pre-existing failures).

## 3. Findings that need no action

- (info) `DiagnosticsTab.tsx:67-69` clipboard copy failure silently resets state — acceptable
  for a copy-to-clipboard affordance; no false-success message shown.
- (info) `connections.ts` `loadConnections` returns `[]` on channel failure — a broken channel
  renders as "no connections" rather than an error banner; deliberate graceful-degrade design.

## 4. Required Integration Changes

**None.** The fix is confined to `packages/longbridge-tools` (message hygiene); no channel,
payload, or export surface changed.

## 5. Concerns (non-blocking, flag only)

1. **Onboarding first-launch latency (concern):** the overlay gate awaits `loadConnections`
   (OnboardingOverlay.tsx:51-65) with no renderer-side timeout. The main-process side is
   bounded by the health probe (health.ts:238, 250: 5s + 10s CLI timeouts, 15s cache TTL
   health.ts:217), so worst case the wizard appears after ~15s on a hung CLI. Not stuck,
   but add a renderer-side timeout (e.g. 4s) if first-launch polish matters in V5.
2. **CI skips fresh-install gate (info):** release-check.mjs includes it (gate 7) but
   release.yml does not run `test:fresh-install`; also "interaction audit"/"secret scan"
   from docs are not mechanically enforced. Consider wiring the full `release:check` step
   (or the missing gates) into CI.

## 6. Pre-existing failures (NOT from this sweep)

`bun test packages/shared` fails 2 tests on the pristine tree (verified via stash):

- `strategy presets > makes comprehensive the union of every other preset`
  (packages/shared/src/strategies/presets.test.ts:52-57) — comprehensive preset references
  a capability not in any other preset.
- `ResearchService > runs a report end-to-end and persists it` — research service e2e.

Both are V5 strategy/research work in flight (untracked `packages/core/src/strategy.ts`,
`packages/shared/src/strategies/`). Neither imports `longbridge-tools`/parser. Owner:
strategy/research agents (Lead). Excluded from this sweep per scope.

## 7. Test evidence

| Command | Result |
|---|---|
| `bun test packages/longbridge-tools` | 65 pass / 0 fail (738 expects) |
| `bun test packages/longbridge-tools packages/shared packages/ui` | 606 pass / 2 fail (both pre-existing §6) |
| `bunx tsc --noEmit -p packages/longbridge-tools` | clean |
| `bunx tsc --noEmit -p packages/ui` | clean |
| Secrets scans (sk-/rk-/pk-/ak-, AKIA, BEGIN PRIVATE KEY, Bearer, ghp_, github_pat_, xox) | only fake test values |

## 8. Verdict

All six audit areas GREEN after the P0 fix, with 2 flagged concerns (onboarding gate
latency, CI gate completeness) and 2 pre-existing V5 in-flight test failures owned by the
strategy/research workstreams. No additional integration changes required.
