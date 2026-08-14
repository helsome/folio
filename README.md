# Folio

AI-native investment research workbench. A desktop app that combines a professional finance workspace (watchlist, quotes, K-line charts, financials, news, portfolio) with an agent copilot that can actually execute financial analysis — built on the Pi Agent runtime, the Longbridge market-data CLI, and a capability layer that turns "skills know how" into "agent can do".

> 一句话：传统行情终端告诉你 **What happened**，Folio 的 Agent 进一步回答 **Why does this matter to you**，并记住 **What did you believe before**、持续监控 **What changed**、最终帮你判断 **Should your thesis change**。

---

## Features

### V1 — Agent Kernel
- Session → Run → AgentRuntime (Pi runtime / local) → AgentEvent streaming → persistence
- Streaming answers, stop/cancel, model & thinking-level switching
- Secure credential store (Electron `safeStorage`, secrets never leave the main process)

### V2 — Finance Workbench
- Watchlist, security workspace (quote header, K-line, overview, financials, news)
- Portfolio, Allotment three-pane workbench, agent context chip
- SkillHub V2: 13 vendored Longbridge skills with progressive loading, references, enable/disable

### V3 — Research & Monitoring Loop
- **Finance Capability Registry** — single source of truth for 20 capabilities (`market.quote` … `portfolio.cashFlow`); Pi agent tools are generated from it (no registry drift), UI availability and skill readiness derive from it. Read-only by design — no order/trading capabilities are exposed.
- **Skill Readiness** — every skill declares required/optional capabilities; the Skills page shows Ready / Partial / Unavailable with missing capability chips; the agent prompt annotates readiness so it never pretends a capability exists.
- **Deep Research** — one click in the security header: parallel capability fetches (concurrency-limited, timeout, cancellable) → structured data bundle → agent synthesis → an evidence-backed `ResearchReport` (stance, confidence, sections, bull/bear case, catalysts, risks; every claim links to the exact capability run that produced it). Partial failures are explicit, never fabricated.
- **Investment Thesis** — save a report as an editable thesis; Re-evaluate fetches fresh data, compares it against the old thesis, and yields a `ThesisImpact` (unchanged / strengthened / weakened / invalidated).
- **Alert Engine** — discriminated alert rules (price, news, earnings, rating change, dividend, position weight, drawdown) evaluated by a main-process scheduler with cooldown, dedup, and market-hours awareness; OS notifications; triggered alerts feed automatic thesis-impact analysis.
- **Compare Workspace** — structured 2–4 symbol comparison (price, market cap, PE/PB, growth, margins, ROE, dividend, 1M/3M/1Y returns, ratings, momentum); missing data renders as `—`, never inferred; the comparison symbols flow into the agent context.
- **Portfolio Risk Center** — allocation, concentration (top-1/top-5/Herfindahl), risk signals (concentration, large positions, upcoming earnings, news exposure, drawdown) with an agent-written summary.
- **Packaged app** — `bun run package` produces a self-contained `Folio.app` that loads skills, the Pi extension, and market data from outside the source repo (resource locator + `extraResources`).

### V4 — Release Candidate & Financial Provider Platform
- **Financial Provider Platform** — market data and brokerage accounts are separate domains: `FinancialDataProvider` (capability-based `execute`) and `BrokerAccountProvider` (portfolio/positions/assets/cash flow), both returning `ProviderResult` with honest provenance (real provider id, fetched time, delayed/stale flags). A `ProviderRouter` (primary + optional fallback) serves every capability; the registry, agent tools, research, alerts, compare, and risk all execute through it — no business layer imports a vendor directly.
- **Longbridge connector** — first-class Connections entry: CLI detection, in-app device-authorization login (verification URL → browser → poll), health probes, permission parsing from `quote_level` (per-market entitlements, delayed-only → Permission Limited), disconnect, and a capability coverage matrix.
- **Massive (Polygon.io) adapter** — secondary market-data provider (quote/kline/profile, US, BYOK API key, fallback slot) proving the router architecture; licensing-first decision in `docs/provider-b-decision.md`.
- **Portfolio reliability** — real-CLI shape normalized into a provider-neutral `PortfolioSnapshot` (multi-currency, unicode names, per-account data, optional numerics); distinct empty/partial/error states; never NaN / `[object Object]` / raw CLI output in the UI.
- **Skills Center** — search + status filters, detail drawer (capabilities ✓/✕, triggers, references, version/author), optimistic toggles with rollback and visible errors, raw markdown moved to Advanced/Developer details.
- **Onboarding & Connections Center** — first-run wizard (welcome/disclaimers → Connect AI → financial data → optional broker → environment health check), one-time disclaimers (re-accessible in Settings/About), completion persisted in the main process; Connections tab with status cards, capability matrix, and BYOK key entry.
- **Today + ⌘K** — lightweight home (portfolio snapshot, watchlist movers, triggered alerts, upcoming events, recent research, theses needing review, quick actions) and a command palette for symbols/navigation/actions.
- **Diagnostics & recovery** — Settings → Diagnostics (version, platform, runtimes, providers, skills, capabilities, resource location, last errors), redacted support-bundle export (keys/tokens/credentials never included), workspace-level React error boundaries with Retry / Open Diagnostics.
- **Data freshness (spec §34)** — quote header, chart (last bar), watchlist, compare, and portfolio all show a `Longbridge · Updated HH:MM:SS` line from the data's own timestamp; nothing is ever presented as fresher than it is.
- **Release pipeline** — `bun run release:check` (unit, typecheck, build, E2E, package, packaged smoke), `release:package` (DMG + SHA256SUMS), CI `release.yml` on `v*` tags with signing/notarization behind secrets, About view (version/channel/build), semver + channel metadata.

### V5 — Discover, Automation & Learning Loop
- **Discover / Screener** — sidebar entry with 17 deterministic screening tasks (market movers, fundamental, technical, events) over a bounded universe; every candidate carries reasons, metrics, and evidence run ids; actions flow into Research (strategy carried forward), Compare, and Watch; runs are persisted as history.
- **Research Strategies** — 8 product-facing presets (Comprehensive / Value / Growth / Technical / Earnings / Event Driven / Risk Review / Income) mapping to real skills + capabilities; the strategy rides the research run and is persisted on the report.
- **Research Diff** — re-researching a symbol builds a structured What Changed view (verdict flips, valuation/rating moves, new risks, confidence deltas) with deterministic materiality; thesis impact is derived from the diff.
- **Scheduled Research & Daily Brief** — five automations (watchlist daily review, portfolio brief, weekly thesis review, pre/post earnings) with material-change filtering: lightweight refresh first, expensive research only for material symbols, notifications for the rest; Today shows the Daily Brief with explainable sources (Portfolio / Watchlist / Thesis / Alert / Automation).
- **Outcome Evaluation** — every report snapshots a ResearchOpinion (stance, confidence, horizon, entry snapshot); at horizon end the Outcome Engine scores it against historical prices (bullish→positive, bearish→negative, neutral→bounded, versioned); Skill/Strategy Performance views aggregate with a 30-sample minimum gate (Observational Only below).
- **Market Pulse & Personal Impact** — indices/status/temperature/movers on Today, plus what-matters-to-me exposure for watchlist/portfolio symbols.
- **Portfolio Import** — CSV/paste → draft with confidence + issues → confirm screen → manual portfolio account (separate from broker accounts) in the Account Selector.
- **Report Export** — Markdown + share card (SVG + text) with privacy redaction (no portfolio/account data).
- **Adaptive Calibration (informational)** — per-skill/strategy reliability from evaluated outcomes, bounded final weights (0.75–1.25), transparent Advanced view (base weight / historical adjustment / samples / Observational Only below 30 samples); no skill files are mutated, runtime weighting is future work.
- **Test architecture** — four-level pyramid (unit → integration → hidden Electron → visible release); `FINAGENT_E2E_HIDDEN=1` by default, `FINAGENT_E2E_VISIBLE=1` / `FINAGENT_E2E_KEEP_OPEN=1` for debugging; root scripts `test:unit|integration|ui|e2e|e2e:visible|package-smoke|release`.

## Architecture

```
Longbridge CLI ─► @finagent/longbridge-tools (fetchers, argv-safe exec)
                      │
                      ▼
   Capability Registry (20 manifests, TypeBox schemas, provenance)
        │                            │
        ├─ Pi tool generation ──► Agent (Pi runtime)
        ├─ UI availability / Skill Readiness
        └─ Product workflows ──► Research / Thesis / Alerts / Compare / Risk
                                      │
                                      ▼
   AgentKernel (main process) ── Session/Run persistence ── event stream ──► React UI
```

| Package | Role |
|---------|------|
| `packages/core` | Types only: domain contracts (capability, research, thesis, alerts, readiness, compare, risk) |
| `packages/shared` | Kernel (sessions/runs/runtime adapters), capability registry + executor, research/thesis/compare/alerts/portfolio-risk services, storage, resource locator |
| `packages/longbridge-tools` | Longbridge CLI wrapper: 20+ fetchers, parsers, typed results |
| `packages/pi-extension` | Pi agent tools generated from the capability registry + skill resource tools |
| `packages/skill-hub` | SKILL.md loader, references, enable/disable, capability requirement map |
| `packages/ui` | React workbench: workspace, research, thesis, compare, portfolio, alerts, settings |
| `apps/electron` | Main process (kernel host, IPC, alert engine), preload bridge, renderer, e2e harness |

## Getting started

Prerequisites: [Bun](https://bun.sh), the [Longbridge CLI](https://open.longbridge.com/longbridge/longbridge-terminal/install) (user-installed — never bundled), and a configured LLM provider for the Pi runtime.

```bash
# 1. Install the Longbridge CLI and authenticate (token lives in ~/.longbridge, never in this repo)
longbridge auth login

# 2. Install dependencies
bun install

# 3. Run the app
bun run dev

# Local (deterministic) agent provider — no LLM needed for the golden path:
FINAGENT_AGENT_PROVIDER=local bun run dev
```

### Commands

| Command | What it does |
|---------|--------------|
| `bun run dev` | Vite dev server for the Electron renderer |
| `bun test` | Full unit/integration suite (all packages) |
| `bun run typecheck` | TypeScript across every package |
| `bun run build` | Packages + renderer + preload + main bundle |
| `cd apps/electron && bun run test:e2e` | Golden-path E2E (CDP-driven; A–H steps: workbench, research, thesis, compare, risk) |
| `cd apps/electron && bun run package` | electron-builder packaged app (`dist/electron/`) |
| `cd apps/electron && bun run test:package-smoke` | Smoke-test the packaged app outside the repo |

## Security model

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; whitelisted preload bridge.
- API keys and custom provider configs are encrypted at rest with Electron `safeStorage` in the **main process**; the renderer sends secrets in once and only ever receives metadata.
- All Longbridge execution is argv-safe (execa arrays), symbol-validated, and **read-only** — no order/trading capability is registered or exposed to the agent.
- Skill resources are loaded through path-safe loaders (no traversal / symlink escapes).
- Local `.env*`, Longbridge account fixtures, and E2E user data are gitignored — see `.gitignore`.

## Status & known limitations

- Unit + integration: **892 tests green**. Typecheck green. E2E golden path A–H + V5 e2e (Discover/Import/Automation/Outcome) green; interaction audit + skills interactions green; fresh-install e2e green (packaged). `bun run release:check` runs 8 release gates.
- **Beta status**: all §64 release blockers closed; see `docs/release-gates.md` for the gate checklist and `docs/provider-b-decision.md` for the secondary-provider licensing decision.
- Packaging: unsigned build (signing/notarization need Apple credentials; CI release workflow is secrets-gated and marks unsigned builds `NOT RELEASEABLE`); `electronDist` is pinned to the local install so packaging works without network.
- The agent-backed synthesizers (research/thesis/risk) use the configured Pi runtime; with `FINAGENT_AGENT_PROVIDER=local` they degrade to deterministic local implementations.
- Massive (Polygon.io) is a **fallback** market-data provider: free tier is end-of-day/delayed with `Individual use` terms — commercial distribution needs a Massive Business plan (see the decision record).

## Documentation

- `docs/architecture.md` — system architecture
- `docs/coding-guide.md` — coding patterns
- `docs/PRD.md` — product requirements
- `docs/longbridge-skill-setup.md` — Longbridge CLI + skill setup
