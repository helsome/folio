# Folio

<p align="center">
  <img src="packages/ui/src/assets/folio-logo.png" alt="Folio logo" width="96" />
</p>

<p align="center">
  <a href="README.en.md">English</a> · <a href="README.md">简体中文</a>
</p>

<p align="center">
  <strong>Local-first AI-native investment research workbench</strong><br />
  Research the market, understand your exposure, and keep an evidence-backed view of what changed.
</p>

<p align="center">
  <a href="https://github.com/helsome/folio/releases">Releases</a> ·
  <a href="docs/architecture.md">Architecture</a> ·
  <a href="docs/PRD.md">Product requirements</a>
</p>

> 一句话：行情终端告诉你 **What happened**；Folio 的 Agent 帮你回答 **Why does this matter to you**，记录 **What did you believe before**，并持续追踪 **What changed**。

## Our Product

Folio is a desktop research environment for public-market investors. It combines a quiet finance workspace with an agent copilot that can fetch structured market data, explain the evidence, and carry research forward into theses, alerts, and portfolio decisions.

Folio is local-first: sessions, credentials, and research state stay on the device by default. Market data and model providers are explicit integrations, not hidden dependencies.

> Folio is a research and decision-support tool. It is read-only by design and does not expose order or trading capabilities.

## Screenshots

<p align="center">
  <img src="docs/screenshots/today.png" alt="Folio Today workspace" width="900" />
</p>

<p align="center">
  <em>Today — portfolio attention items, market pulse, events, and quick research actions.</em>
</p>

<p align="center">
  <img src="docs/screenshots/workspace.png" alt="Folio security workspace" width="49%" />
  <img src="docs/screenshots/events.png" alt="Folio Events & Catalysts" width="49%" />
</p>

<p align="center">
  <img src="docs/screenshots/portfolio.png" alt="Folio portfolio" width="49%" />
  <img src="docs/screenshots/profile.png" alt="Folio profile & workspace health" width="49%" />
</p>

<p align="center">
  <img src="docs/screenshots/settings.png" alt="Folio settings center" width="49%" />
  <img src="docs/screenshots/evaluation.png" alt="Folio Agent evaluation settings" width="49%" />
</p>

<p align="center">
  <img src="docs/screenshots/skills.png" alt="Folio skills center" width="49%" />
  <img src="docs/screenshots/discover.png" alt="Folio discover" width="49%" />
</p>

<p align="center">
  <em>From the security workspace, events & catalysts, and portfolio overview to settings, skill readiness, and evaluation tracing — with no services connected, every page above renders built-in sample data (badged “Sample data”).</em>
</p>

## Key Features

### Research Workspace

- Watchlists, quotes, K-line charts, financial statements, news, and security overviews.
- A three-pane desktop layout: navigation, market workspace, and Agent copilot, with persistent asset tabs (K-Lines / Statements / News / Reports) in the workspace topbar.
- Compare 2–4 symbols across valuation, growth, margins, ROE, dividends, returns, ratings, and momentum.
- Data freshness is visible; missing values render as `—` instead of being guessed.

### Built-in Sample Data (offline fallback)

- With no market-data provider or LLM connected, Today, the portfolio card, Market Pulse, events, and the daily brief render built-in sample data — the workspace is complete from the very first launch.
- Every sample surface carries a visible “Sample data” badge (with a tooltip explaining how to connect real sources); error details stay in the underlying state, and live data replaces samples the moment it becomes available.
- Symbols outside the sample set (e.g. `0700.HK`) keep their honest empty/error states — nothing is fabricated.

### Deep Research

- One-click research from a focused security.
- Parallel capability fetches with bounded concurrency, timeouts, cancellation, and honest partial-failure states.
- Structured data bundle → agent synthesis → evidence-backed `ResearchReport`.
- Reports contain stance, confidence, sections, bull case, bear case, catalysts, risks, and links back to the capability run behind each claim.

### Agent Copilot

- Persistent sessions and streamed answers powered by the Pi Agent runtime.
- Model and thinking-level controls, stop/cancel, workspace context, and structured quote/portfolio cards.
- Markdown answers render with headings, lists, tables, links, and code blocks.
- Internal synthesis sessions stay out of the visible conversation history.

### Agent Evaluation & Observability

- An integrated Evaluation Center for experiments, baselines, model comparisons, failure modes, case details, and human feedback.
- Coverage includes task completion, tool selection and arguments, evidence/provenance, latency, failure recovery, research completeness, and decision usefulness.
- Supports local offline evaluation and optional LangSmith tracing; tracing is off by default, with privacy level and API-key controls in Settings.
- The `folio-agent-v1` benchmark contains 86 golden, difficult, long-tail, tool-failure, regression, and adversarial cases; fixed bugs become regression gates.
- Pull requests use a zero-cost deterministic smoke eval, while the full benchmark and model/strategy experiments run on demand or on a schedule.

### Skills & Capability Layer

- A single capability registry powers provider execution, agent tools, UI availability, and skill readiness.
- Skills declare required and optional capabilities; the Skills Center shows Ready, Partial, and Disabled states.
- Progressive loading keeps skill instructions and reference material available without putting every document into every prompt.
- The agent never claims a missing capability is available.

### Discover & Learning Loop

- 17 deterministic screening tasks across market movers, fundamentals, technicals, and events.
- Eight research strategies: Comprehensive, Value, Growth, Technical, Earnings, Event Driven, Risk Review, and Income.
- Candidate actions flow into Research, Compare, and Watchlist with evidence and reasons attached.
- Research Diff highlights changed verdicts, valuation moves, new risks, and confidence deltas.

### Portfolio, Thesis & Monitoring

- Portfolio allocation, concentration, Herfindahl, large-position, earnings, news, drawdown, and exposure signals.
- Save a report as an editable investment thesis and re-evaluate it against fresh data.
- Alert rules for price, news, earnings, ratings, dividends, position weight, and drawdown.
- Today combines portfolio attention items, watchlist movers, alerts, upcoming events, recent research, and theses needing review.
- A dedicated **Events & Catalysts page**: earnings, macro releases, and central-bank calendar events, with one-click context handoff into Research.
- A **Profile page** with at-a-glance local workspace health (AI / market data / skills / agent runtime).

## How It Works

```text
Longbridge / Massive providers
              │
              ▼
     Capability Registry
              │
       ┌──────┼───────────────┐
       ▼      ▼               ▼
    Agent   Research       Product UI
    tools   + Thesis       + Skills
             + Alerts      + Compare
             + Risk        + Today
              │
              ▼
     Evidence-backed reports
```

The core boundary is deliberately small: providers return normalized data with provenance, capabilities expose typed operations, and product workflows consume those contracts instead of importing vendor-specific code.

## Flexible Integrations

- **Market data:** Longbridge is the primary connector for US/HK/CN market data and brokerage portfolio access; Massive is available as a secondary US market-data provider.
- **Agent runtime:** Pi runtime for configured LLM providers, with a deterministic local provider for development and offline golden paths.
- **Desktop:** Electron with a macOS arm64 packaged build. The renderer, preload bridge, and main-process kernel are separated by context isolation and a whitelisted IPC surface.
- **Skills:** Vendored `SKILL.md` resources with references, enable/disable state, triggers, and capability requirements, plus safe local user-skill installation from **Settings → Skills**.
- **Agent evaluation:** Local or LangSmith-backed evaluation records traces, datasets, evaluators, experiments, and regression gates; engineering metrics can be linked to investment outcomes without claiming causation.

## Quick Start

### For Users

Download the latest macOS build from the [Releases page](https://github.com/helsome/folio/releases). After launching Folio:

1. The full workspace is browsable on first launch — built-in sample data (badged “Sample data”) is shown until services are connected.
2. Configure an LLM provider in **Settings → Models**, or use the local provider for a deterministic demo.
3. Connect Longbridge in **Settings → Connections** for live market data and portfolio access; sample data switches to live data automatically.
4. Select a symbol from the Watchlist and open **Deep Research**.

To extend the agent, open **Settings → Skills**, choose **Install from folder**,
and select a skill package containing `SKILL.md`. User skills are stored under
`~/.finagent/skills/`; bundled skills cannot be overwritten, and removing a
user skill moves its package to the system Trash.

Longbridge authentication can also be completed from the terminal:

```bash
longbridge auth login
```

### For Developers

Prerequisites: [Bun](https://bun.sh), the [Longbridge CLI](https://open.longbridge.com/longbridge/longbridge-terminal/install) for live data, and an LLM provider for the Pi runtime.

```bash
# Clone and install
git clone https://github.com/helsome/folio.git
cd folio
bun install

# Run the desktop app in development
bun run dev

# Deterministic local agent path — no external LLM required
FINAGENT_AGENT_PROVIDER=local bun run dev
```

### Commands

| Command | Description |
| --- | --- |
| `bun run dev` | Start the Electron renderer in development mode |
| `bun test` | Run the full unit and integration suite |
| `bun run typecheck` | Typecheck every workspace package |
| `bun run build` | Build packages, renderer, preload, and main process |
| `bun run test:e2e` | Run the Electron golden-path E2E suite |
| `bun run eval:smoke` | Run the deterministic PR-level Agent regression eval |
| `bun run eval:full` | Run the full Agent benchmark and experiment flow |
| `bun run release:check` | Run the release gates |
| `bun run release:package` | Build the macOS arm64 app, DMG, and SHA256 checksums |

The packaged artifacts are staged in `dist/release/`.

## Security & Product Boundaries

- Electron runs with `contextIsolation: true`, `nodeIntegration: false`, and a whitelisted preload bridge.
- API keys and custom provider credentials are encrypted at rest with Electron `safeStorage` in the main process.
- Longbridge commands use argv-safe execution, symbol validation, and read-only capability registration.
- Skill resources are path-safe: traversal and symlink escapes are rejected.
- Research reports distinguish unavailable data from negative evidence and never fabricate missing numbers.
- Agent tracing is off by default; standard privacy redacts prompts, answers, arguments, and portfolio tool results, while full tracing requires explicit opt-in.
- Unsigned local builds may trigger a macOS security prompt; signing and notarization are opt-in release steps.

## Project Status

Folio is in beta. The current repository includes the V5 research, discovery, monitoring, outcome, and adaptive-calibration surfaces, plus a refreshed visual system implementing the Stitch “Minimalist Personal Portfolio” design language: a redrawn sidebar and workspace topbar, new Events & Catalysts and Profile pages, a unified component library and radius scale, and the offline sample-data fallback.

Agent engineering evaluation (V7) is now wired into Settings and the Evaluation Center: LangSmith connection, privacy controls, benchmark experiments, failure-mode analysis, case-level traces, and human feedback are available as an advanced workflow.

- Unit and integration tests: **1157+ passing**
- Typecheck: **green**
- Electron E2E and packaged smoke gates: available through the release scripts
- Current package channel: `0.4.0-beta.2`

Known limitations and release decisions are documented in [`docs/release-gates.md`](docs/release-gates.md) ([简体中文](docs/release-gates.zh-CN.md)) and [`docs/provider-b-decision.md`](docs/provider-b-decision.md) ([简体中文](docs/provider-b-decision.zh-CN.md)).

## Roadmap

### Near Term

- More provider coverage behind the same capability contracts.
- Better report navigation and evidence inspection.
- Valuation comparison table (CURRENT vs 5Y AVG) and target-price cards for the security workspace (see [`docs/design-comparison.md`](docs/design-comparison.md)).
- More useful portfolio-aware research prompts without leaking internal runtime instructions into the user conversation.

### Longer Term

- Cross-platform packaged builds.
- More research strategies and outcome calibration samples.
- Richer scheduled briefs, notification channels, and user-defined monitoring rules.
- A contributor-friendly skill and provider extension model.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — system architecture and runtime boundaries · [简体中文](docs/architecture.zh-CN.md)
- [`docs/PRD.md`](docs/PRD.md) — product requirements and invariants (document is in Chinese)
- [`docs/UI-SYSTEM.md`](docs/UI-SYSTEM.md) — visual system and component rules · [简体中文](docs/UI-SYSTEM.zh-CN.md)
- [`docs/longbridge-auth.md`](docs/longbridge-auth.md) — Longbridge authentication · [简体中文](docs/longbridge-auth.zh-CN.md)
- [`docs/longbridge-skill-setup.md`](docs/longbridge-skill-setup.md) — skill setup and capability coverage · [简体中文](docs/longbridge-skill-setup.zh-CN.md)
- [`docs/release-gates.md`](docs/release-gates.md) — release validation checklist · [简体中文](docs/release-gates.zh-CN.md)
- [`docs/EVALUATION.md`](docs/EVALUATION.md) — Agent evaluation, LangSmith observability, and experiment architecture · [CI strategy](docs/EVALUATION-CI.md) · [benchmark](docs/EVALUATION-BENCHMARK.md)
- [`docs/design-comparison.md`](docs/design-comparison.md) — screen-by-screen comparison between the Stitch designs and the current implementation

## Contributing

Issues and pull requests are welcome. Before opening a change, run:

```bash
bun test
bun run typecheck
```

For UI changes, include a screenshot or a short visual QA note when the layout or interaction changes materially.
