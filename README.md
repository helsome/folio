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

- Unit + integration: 324 tests green. Typecheck green. E2E golden path A–H green (workbench → Deep Research → evidence-backed report → thesis → compare → portfolio risk, real Longbridge data). Packaged-app smoke green (20 capability tools, 13 skills, local run completes outside the source repo).
- Packaging: unsigned `mac.target: 'dir'` build (signing/notarization and DMG target need Apple credentials); `electronDist` is pinned to the local install so packaging works without network.
- The agent-backed synthesizers (research/thesis/risk) use the configured Pi runtime; with `FINAGENT_AGENT_PROVIDER=local` they degrade to deterministic local implementations.

## Documentation

- `docs/architecture.md` — system architecture
- `docs/coding-guide.md` — coding patterns
- `docs/PRD.md` — product requirements
- `docs/longbridge-skill-setup.md` — Longbridge CLI + skill setup
