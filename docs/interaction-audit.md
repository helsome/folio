# Folio Interaction Audit & Button-Contract Sweep

Last sweep: **2026-08-14** — `apps/electron/e2e/interactions.mjs`, 31 controls
probed (29 pass, 1 known-broken, 1 skipped).

This is a **continuous** artifact. It tracks every user-facing control across the
app, records which ones are verified live vs. by inspection, and lists controls
that look clickable but do nothing or silently fail. When later slices land
(Connections / Today / Onboarding), append their controls here and to
`apps/electron/e2e/interactions.mjs`.

---

## 1. Harness

- File: `apps/electron/e2e/interactions.mjs` (plain Node runner over raw CDP,
  same pattern as `e2e/run.mjs`).
- Launch: own Electron instance, `--remote-debugging-port=9337`,
  `FINAGENT_FORCE_PROD_LOAD=1`, `FINAGENT_AGENT_PROVIDER=local`, isolated
  `FINAGENT_USER_DATA_DIR=e2e/.user-data-interactions`.
- Run: `node e2e/interactions.mjs` (requires integration change: add
  `"test:interactions": "node e2e/interactions.mjs"` to `apps/electron/package.json`
  — Lead-owned, not edited here).
- **Contract**: a click must produce one of
  - `aria` — `aria-expanded`/`aria-pressed`/`aria-checked`/`aria-selected` change
  - `dialog` — a modal (`[role="dialog"]`, `.fixed.inset-0`, or `[aria-label="Close dialog"]`) opens/closes
  - `structure` — new/removed `data-testid` elements (navigation/render)
  - `content` — text/content within the scope changed (data arrived over IPC)
- IPC activity is observed **indirectly**: a control's IPC round-trip is proven by
  the data-driven DOM mutation it causes (e.g. `portfolio-risk-panel` appears after
  `portfolioRisk.analyze`, the skills list renders after `skills.list`). The
  preload bridge (`contextBridge`) freezes its API, so method-call interception is
  not reliable; DOM state is the contract.

---

## 2. Inventory

Status legend:
- ✅ **sweep** — exercised live by `interactions.mjs`
- 🟡 **inspection** — verified by code reading (window IPC, data-conditional, or already covered by `run.mjs` golden path)
- ❌ **broken** — see Findings (§3)

### TitleBar

| Control | Expected behavior | Test | Status |
|---|---|---|---|
| Close (traffic light) | `window.close()` IPC | — | 🟡 inspection (not asserted; kills the app) |
| Minimize | `window.minimize()` IPC | — | 🟡 inspection |
| Maximize / Restore | `window.maximize()`/`unmaximize()` + toggle | — | 🟡 inspection |
| About (ⓘ) | opens "About Folio" dialog | `TitleBar > About (opens dialog)` | ✅ sweep (dialog) |
| About dialog × | closes dialog | `TitleBar > About (close dialog)` | ❌ broken (Finding 2) |

### Sidebar

| Control | Expected behavior | Test | Status |
|---|---|---|---|
| Sessions header | highlights + shows security workspace | shared path w/ Watchlist header | 🟡 inspection |
| New Session | `sessions:create` IPC → new session | bootstrap | ✅ sweep |
| Session row | `setActiveSessionId` | — | 🟡 inspection |
| Delete session (hover ×) | `sessions:delete` IPC | — | 🟡 inspection |
| Watchlist header | highlights + shows security workspace | `Sidebar > Watchlist section header` | ✅ sweep |
| nav Portfolio / Alerts / Research / Thesis / Compare / Skills | `setNavSection` → section | one probe each | ✅ sweep |
| **Settings** | (should open Settings) | — | ❌ broken (Finding 1) — no control exists |
| Agent Panel toggle | collapse/expand (aria-pressed) | `Sidebar > Agent Panel toggle` ×2 | ✅ sweep (aria) |

### Watchlist

| Control | Expected behavior | Test | Status |
|---|---|---|---|
| Symbol input + Add | validate + `addToWatchlistAtom` | — | 🟡 inspection (local atom) |
| Row select | `setActiveSymbol` + `setActiveView('overview')` | `Watchlist > row select (TSLA.US)` | ✅ sweep (structure) |
| Remove row (hover ×) | `removeFromWatchlistAtom` | — | 🟡 inspection |

### Chart / SecurityWorkspace

| Control | Expected behavior | Test | Status |
|---|---|---|---|
| Workspace tabs Overview / Chart / Financials / News | `setActiveView` | `Workspace tab > …` ×4 | ✅ sweep (content) |
| Chart period 1m/5m/15m/1h/1d/1w | `setPeriod` (aria-pressed) | `Chart > period 5m` / `1d` | ✅ sweep (aria) |
| Chart Retry (error state) | `retryToken++` → refetch | — | 🟡 inspection (error-only) |

### SecurityHeader

| Control | Expected behavior | Test | Status |
|---|---|---|---|
| Deep Research | `setNavSection('research')` | `SecurityHeader > Deep Research (navigates)` | ✅ sweep |

### Research

| Control | Expected behavior | Test | Status |
|---|---|---|---|
| Deep Research (start) | `research.start` IPC → run | golden path `run.mjs` step E | 🟡 inspection (long-running; kept out of sweep) |
| Stop | `research.cancel` IPC | — | 🟡 inspection |
| Run-history row | load report | — | 🟡 inspection |

### Thesis

| Control | Expected behavior | Test | Status |
|---|---|---|---|
| Save as Thesis | `saveThesisFromReport` IPC | golden path `run.mjs` step F | 🟡 inspection (conditional on report) |
| Edit / Re-evaluate (thesis card) | editor / `reEvaluateThesis` IPC | — | 🟡 inspection |
| ThesisEditor save/cancel | update/cancel edit | — | 🟡 inspection |

### Compare

| Control | Expected behavior | Test | Status |
|---|---|---|---|
| Add symbol | `compareSymbolsAtom` + `compare.build` IPC | `Compare > Add symbol` | ✅ sweep (content) |
| Remove chip | remove symbol | — | 🟡 inspection |

### Portfolio

| Control | Expected behavior | Test | Status |
|---|---|---|---|
| Analyze Portfolio | `portfolioRisk.analyze` IPC → risk panel | `Portfolio > Analyze Portfolio` | ✅ sweep (structure) |
| Holding row | select position + focus symbol | — | 🟡 inspection |

### Alerts

| Control | Expected behavior | Test | Status |
|---|---|---|---|
| + New | opens form dialog | `Alerts > + New (opens form dialog)` | ✅ sweep (dialog) |
| Cancel | closes dialog | `Alerts > Cancel (closes dialog)` | ✅ sweep (dialog) |
| Alert type buttons | `setType` | — | 🟡 inspection (in dialog) |
| Create Alert (submit) | `addAlert` IPC | — | 🟡 inspection |
| Alert enable/disable toggle | `toggleAlert` IPC | — | 🟡 inspection |
| Alert remove × | `removeAlert` IPC | — | 🟡 inspection |

### Skills

| Control | Expected behavior | Test | Status |
|---|---|---|---|
| Search input (`skills-search`) | filters list | `Skills > search filters list` | ✅ sweep (content) |
| Status chips (`skills-filter-*`) | filter by readiness (aria-pressed) | `Skills > status filter chip` | ✅ sweep (aria) |
| Skill row (`skill-row-<id>`) | opens detail drawer | `Skills > open detail drawer` | ✅ sweep |
| Drawer toggle (`role=switch`) | `skills.setEnabled` IPC (aria-checked) | `Skills > drawer toggle` | ✅ sweep (aria; see Finding 2) |
| Drawer close / Esc | closes drawer | Esc (cleanup) | ✅ sweep |
| Advanced toggle (`skill-advanced-toggle`) | expand SKILL.md (aria-expanded) | — | 🟡 inspection |
| Resource chip (`skill-resource-<path>`) | load reference content | — | 🟡 inspection |
| Home-row toggle (`role=switch`) | `skills.setEnabled` IPC | `Skills > enable/disable toggle` | ✅ sweep (aria) |

> SkillsUx also landed a Skills-specific harness `e2e/skills-interactions.mjs`
> (loading/badge/drawer/advanced/resource/keyboard/optimistic-toggle). Both files
> target the same `skill-*` testids and are complementary; the contract sweep here
> stays surface-wide.

### Settings (unreachable — Finding 1)

| Control | Expected behavior | Status |
|---|---|---|
| Settings page | render `SettingsView` | ❌ no nav entry |
| Tabs General / Models / Longbridge / Skills | `setTab` | ❌ unreachable |
| Models: Refresh / Save / Remove / Test / Add custom provider | `llm.*` IPC | ❌ unreachable |
| Longbridge status (read-only) | `longbridge.getStatus` | ❌ unreachable |

### LLM selector (AgentPanel header + Models tab)

| Control | Expected behavior | Test | Status |
|---|---|---|---|
| Model selector (open) | dropdown (aria-expanded) | `LLM selector > open model dropdown` | ✅ sweep (aria) |
| Model option (select) | `setModel` IPC | — | 🟡 inspection (no models in local runtime) |
| Thinking selector | dropdown; disabled when no levels | — | 🟡 inspection (disabled in local runtime) |
| Collapse agent panel | `setAgentPanelVisible(false)` | — | 🟡 inspection |

### AgentPanel

| Control | Expected behavior | Test | Status |
|---|---|---|---|
| Send | `kernel.startRun` IPC → run-panel | `Agent > Send (starts run)` | ✅ sweep (content) |
| Stop | `cancelRun` IPC | — | 🟡 inspection |
| Create New Session (empty state) | `sessions:create` IPC | — | 🟡 inspection |

---

## 3. Findings

### Finding 1 — Settings page is unreachable (no navigation entry)

- **Severity**: broken (feature fully inaccessible).
- **Repro**: launch the app; no control (sidebar item, gear, shortcut) opens the
  Settings section. `SettingsView` + its tabs (General / Models / Longbridge /
  Skills) are wired into `FinanceWorkspace` (`case 'settings'`), but nothing ever
  calls `setNavSection('settings')`. `Sidebar` `NAV_ITEMS` omits `settings`, and
  the only `setNavSection` calls target `sessions` / `watchlist` / the six nav keys
  / `research`.
- **Impact**: every LLM/credential setting (`ModelsTab`), Longbridge status view,
  and the Settings-hosted Skills tab is invisible to users.
- **Owning slice**: Lead integration (nav wiring) + ProviderCore (`ModelsTab`/LLM
  credentials) + SkillsUx (Skills tab reuse). Suggested fix: add a `settings` item
  to `Sidebar` `NAV_ITEMS` (or a gear affordance) that calls `setNavSection('settings')`.

### Finding 2 — Modal/dropdown z-index utilities compile to invalid CSS

- **Severity**: broken (position-dependent; one control reliably unclickable).
- **Root cause**: `z-[--z-index-modal]` and `z-[--z-index-dropdown]` compile to
  `z-index: --z-index-modal` / `z-index: --z-index-dropdown` — a raw token, not
  `var(--…)`. The browser drops the invalid declaration, so every modal/dropdown
  overlay renders at `z-index: auto`. Verified in the built CSS
  (`dist/renderer/assets/*.css`) and at runtime (`getComputedStyle().zIndex === 'auto'`).
- **Affected files** (all in `packages/ui/src/components`):
  - `primitives/Dialog.tsx` (`z-[--z-index-modal]`)
  - `settings/SkillDetailDrawer.tsx` (`z-[--z-index-modal]`)
  - `agent/ModelSelector.tsx` (`z-[--z-index-dropdown]`)
  - `agent/ThinkingSelector.tsx` (`z-[--z-index-dropdown]`)
- **Observable symptom (reliable)**: the TitleBar **About** dialog's × close button
  is unclickable — `elementFromPoint` resolves to the Allotment vertical sash
  (`z-index: 5`), which paints above the z-auto overlay. Repro: `About (ⓘ)` →
  click the × → nothing happens (Esc still closes it). `interactions.mjs` reports
  `BROKEN (known)  TitleBar > About (close dialog)`.
- **Observable symptom (intermittent)**: the `SkillDetailDrawer` surface can be
  occluded by the agent panel pane when a control's position aligns with the pane
  (pointer events intercepted). SkillsUx has begun mitigating this with
  `createPortal` (renders to `document.body`), which moves the drawer out of the
  Allotment pane stacking context — but the invalid `z-index` remains, so the
  drawer still sits at `z-index: auto` relative to the sash/titlebar.
- **Fix** (one line per file, Tailwind v4 arbitrary-value syntax):
  `z-[--z-index-modal]` → `z-(--z-index-modal)` (or `z-[var(--z-index-modal)]`);
  likewise `z-[--z-index-dropdown]` → `z-(--z-index-dropdown)`.
- **Owning slice**: UI primitives / ProviderCore (ModelSelector, ThinkingSelector,
  Dialog) + SkillsUx (SkillDetailDrawer). Cross-slice; recommend Lead-coordinated
  one-line fix.

### Observation (not broken)

- **Local runtime has no LLM models / thinking levels.** With
  `FINAGENT_AGENT_PROVIDER=local`, the model dropdown is empty ("No models
  available") and the thinking selector is disabled (visible disabled state +
  tooltip). The model *dropdown* still opens/closes correctly, so no broken
  control — just an environment-limited "choose model" path that cannot be
  exercised locally. Owning: ProviderCore (LLM registry).

---

## 4. Coverage note (continuous)

Connections / Today / Onboarding surfaces do not exist yet in this sweep. When
they land, add their controls to the inventory table above and append matching
`probe(...)` blocks to `interactions.mjs` (reuse the `probe(page, name, scope,
trigger, { expect | waitFor | waitForFn | settle | knownBroken })` helper). Mark
any control that regresses to a silent no-op as `knownBroken` in the harness and
file it under §3.
