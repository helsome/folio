# Folio

<p align="center">
  <img src="packages/ui/src/assets/folio-logo.png" alt="Folio logo" width="96" />
</p>

<p align="center">
  <a href="README.en.md">English</a> · <a href="README.md">简体中文</a>
</p>

<p align="center">
  <strong>Local-first AI-native investment research workbench</strong><br />
  Research the market, understand exposure, and keep judgments in evidence-backed reports, theses, and alerts.
</p>

<p align="center">
  <a href="https://github.com/helsome/folio/releases">Releases</a> ·
  <a href="docs/architecture.md">Architecture</a> ·
  <a href="docs/PRD.md">Product requirements</a>
</p>

> A quote terminal tells you **What happened**. Folio’s agent is there to answer **Why does this matter to you**, record **What did you believe before**, and keep tracking **What changed**.

## Our Product

Folio is a desktop research environment for public-market investors. Navigation sits on the left, the finance workspace (watchlist, K-line, filings, news, research reports) sits in the center, and an agent copilot that can see the current page and symbol stays on the right. Selecting a symbol moves the chart, overview, research, and agent context together.

Folio is local-first: sessions, credentials, and research state stay on the device by default. Market data and models are explicit providers. Secrets live in a main-process credential store.

> Folio is a research and decision-support tool, and it is read-only. The capability registry has no order or trading capability.

Current package version: `0.4.0-beta.2`.

## Screenshots

These images are from a real macOS run of Folio `0.4.0-beta.2` (Electron). US quotes and daily/weekly candles come from Yahoo Finance and are labeled as delayed. Longbridge CLI was not installed on that machine, so filings, news, and depth that depend on Longbridge say they are unavailable. Portfolio and events use the app’s built-in sample data and show a “Sample data” badge.

### Today

<p align="center">
  <img src="docs/screenshots/today.jpg" alt="Folio Today: assets, watchlist movers, upcoming events, and the agent panel" width="900" />
</p>

<p align="center">
  <em>Today. Three panes: navigation, workspace, and agent. Total assets and some cards are sample data; US quotes in the watchlist are delayed Yahoo Finance data. Shortcuts include deep research, portfolio review, and compare.</em>
</p>

### Workspace: K-line, overview, and news

<p align="center">
  <img src="docs/screenshots/kline.jpg" alt="NVDA.US daily candles with moving averages and volume, source Yahoo Finance Delayed" width="900" />
</p>

<p align="center">
  <em>K-line. NVDA.US daily candles with EMAs and volume. The corner reads “Yahoo Finance · Delayed”. Periods can be switched; Yahoo supplies daily and weekly candles.</em>
</p>

<p align="center">
  <img src="docs/screenshots/overview.jpg" alt="Security overview with sample NVDA shares and weight" width="49%" />
  <img src="docs/screenshots/news.jpg" alt="News view stating that Longbridge CLI is not installed" width="49%" />
</p>

<p align="center">
  <em>Left: the report/overview puts quote, position, and research together (the position here is sample data). Right: news depends on Longbridge; with the CLI missing, the page states why instead of rendering a blank panel.</em>
</p>

### Deep research

<p align="center">
  <img src="docs/screenshots/research-running.jpg" alt="Deep research in progress, with per-capability fetch status" width="49%" />
  <img src="docs/screenshots/research.jpg" alt="Research finished: partial run, bearish, 55 percent confidence" width="49%" />
</p>

<p align="center">
  <em>Left: research in progress, one row per capability. Right: a comprehensive NVDA.US run. Quote, K-line, and company profile succeeded out of 16 planned capabilities; the rest failed because Longbridge was not installed. Status is a partial run. Stance is bearish at 55% confidence.</em>
</p>

<p align="center">
  <img src="docs/screenshots/research-report.jpg" alt="Research report with evidence table, stance, summary, and save-as-thesis" width="720" />
</p>

<p align="center">
  <em>Report body: evidence table (source, claim, freshness, confidence), stance and summary, and Save as thesis.</em>
</p>

### Investment thesis

<p align="center">
  <img src="docs/screenshots/thesis-save.jpg" alt="Saving a research report as an investment thesis" width="49%" />
  <img src="docs/screenshots/thesis.jpg" alt="NVDA.US thesis page with assumptions and review status" width="49%" />
</p>

<p align="center">
  <em>A report can be saved as an editable thesis with review status. Today lists theses that are due for review.</em>
</p>

### Compare

<p align="center">
  <img src="docs/screenshots/compare.jpg" alt="Compare NVDA, AAPL, TSLA, and MSFT on price and returns" width="900" />
</p>

<p align="center">
  <em>Compare 2–4 symbols. Price and 1-month / 3-month / 1-year returns come from Yahoo. Valuation and financial rows render as “—” without Longbridge. While Compare is focused, the agent context includes those symbols.</em>
</p>

### Discover

<p align="center">
  <img src="docs/screenshots/discover.jpg" alt="Discover page with deterministic screens and zero candidates" width="900" />
</p>

<p align="center">
  <em>Seventeen deterministic screens across movers, fundamentals, technicals, and events. The page states that the rules use market data and do not run an AI scan. An empty result stays empty and suggests changing the screen, adding symbols, or checking the data connection.</em>
</p>

### Portfolio

<p align="center">
  <img src="docs/screenshots/portfolio.jpg" alt="Portfolio sample data: allocation and holdings" width="900" />
</p>

<p align="center">
  <em>Portfolio (sample data): total assets, cash, allocation, and holdings. Each row can start deep research. The analysis below covers allocation, concentration, Herfindahl, large positions, drawdown, and exposure. Holdings can be imported.</em>
</p>

### Events and catalysts

<p align="center">
  <img src="docs/screenshots/events.jpg" alt="Events and catalysts page with a sample-data badge" width="900" />
</p>

<p align="center">
  <em>Events and catalysts (sample data): earnings, macro releases, and the central-bank calendar. Each row can open research with that context. Alert rules also cover price, news, earnings, ratings, dividends, position weight, and drawdown.</em>
</p>

### Agent copilot

<p align="center">
  <img src="docs/screenshots/agent-running.jpg" alt="Agent running, with a stop control" width="49%" />
  <img src="docs/screenshots/source-inspector.jpg" alt="Source inspector listing tool data cited by the answer" width="49%" />
</p>

<p align="center">
  <img src="docs/screenshots/agent.jpg" alt="Agent answer describing a data gap after tools failed" width="49%" />
  <img src="docs/screenshots/tool-activity.jpg" alt="Tool activity with symbol, duration, and status for each call" width="49%" />
</p>

<p align="center">
  <em>The agent knows the current page and symbol. Model and thinking level can be changed, and a run can be stopped. This question asked for an NVDA quote and candles. <code>get_quote</code>, <code>get_kline</code>, and <code>get_market_status</code> failed because Longbridge CLI was not installed. The answer is a data-gap note and does not invent a price. Tool activity and the source inspector expand each call.</em>
</p>

### Skills

<p align="center">
  <img src="docs/screenshots/skills.jpg" alt="Skills center with bundled skills, toggles, and capability counts" width="49%" />
  <img src="docs/screenshots/skill-detail.jpg" alt="Skill detail with required and optional capabilities and reference files" width="49%" />
</p>

<p align="center">
  <em>The skills center lists bundled skills, enablement, and capability dependencies. The detail view separates required and optional capabilities, readiness, and reference files.</em>
</p>

### Evaluation

<p align="center">
  <img src="docs/screenshots/evaluation.jpg" alt="Evaluation overview for a folio-agent-v1 fixture experiment" width="49%" />
  <img src="docs/screenshots/evaluation-detail.jpg" alt="Experiment detail with metric scores and per-case runs" width="49%" />
</p>

<p align="center">
  <em>Evaluation center: overview, experiments, model comparison, and failure modes. The figure is a local fixture experiment for <code>folio-agent-v1</code> (15 runs), showing task completion, tool selection, evidence, and freshness. It is not a return claim.</em>
</p>

### Settings, connections, and profile

<p align="center">
  <img src="docs/screenshots/settings.jpg" alt="General settings: agent runtime, model, and thinking level" width="49%" />
  <img src="docs/screenshots/settings-llm.jpg" alt="LLM settings: runtime and provider status" width="49%" />
</p>

<p align="center">
  <img src="docs/screenshots/settings-connections.jpg" alt="Connections: Longbridge not installed, Yahoo Finance connected" width="49%" />
  <img src="docs/screenshots/profile.jpg" alt="Profile and security: local workspace health" width="49%" />
</p>

<p align="center">
  <em>Settings → General: runtime, current model, thinking level, and language. Settings → LLM: provider status; secrets are not echoed. Settings → Connections: Longbridge not installed, Massive not connected, Yahoo Finance connected (delayed, unofficial, personal use). Profile &amp; Security summarizes local workspace health. Diagnostics can copy or export a health snapshot.</em>
</p>

### Command palette

<p align="center">
  <img src="docs/screenshots/cmdk.jpg" alt="Command palette opened with Command-K, listing pages" width="900" />
</p>

<p align="center">
  <em>⌘K opens the command palette from any page to search pages, symbols, and actions.</em>
</p>

## Key Features

### Research workspace

- Watchlist, quotes, K-line, financial statements, news, and security overview. Top tabs switch among K-line, statements, news, and reports.
- Three-pane desktop layout: navigation, market workspace, and agent copilot.
- Charts label their source. The Yahoo Finance path is delayed US daily and weekly candles, with moving averages.
- Freshness is visible. Missing values render as `—`. Unavailable data states the reason (for example, Longbridge CLI is not installed).

### Deep research

- Structured research from the focused symbol: plan → bounded parallel capability calls (timeouts and cancellation) → data bundle → model synthesis → `ResearchReport`.
- A report contains stance, confidence, sections, bull case, bear case, catalysts, risks, and a link from each claim back to the capability run.
- A report can still be produced when some capabilities fail. The status is a partial run, and unavailable data is listed item by item.
- Research has checkpoints. States include queued, fetching, synthesizing, complete, partial, failed, and cancelled.
- Eight research strategies: Comprehensive, Value, Growth, Technical, Earnings, Event Driven, Risk Review, and Income.
- Export can copy Markdown, download `.md`, copy share text, or download a share card `.svg`.
- After more than one run on the same symbol, Research Diff compares verdicts, valuation, new risks, and confidence.

### Investment thesis

- Save a report as an editable thesis: claim, key assumptions, and review status.
- Re-evaluate it when new data arrives. Today lists theses due for review.

### Multi-symbol compare

- Place 2–4 symbols side by side across valuation, growth, margins, ROE, dividends, returns, ratings, and momentum.
- Fields a provider does not have stay as `—`. On the compare page the agent context includes the current set.

### Discover

- Seventeen deterministic screens across movers, fundamentals, technicals, and events. Screening is rules, not a model scan.
- Candidates can go to research, compare, or the watchlist, with evidence and reasons attached.
- A miss stays empty, with hints for changing the universe or checking the connection.

### Portfolio and risk

- Total assets, cash, allocation, quantity, cost, and profit or loss. A holding row can open deep research. Holdings can be imported.
- Portfolio analysis covers allocation, concentration, Herfindahl, large positions, earnings, news, drawdown, and exposure.
- Without a brokerage connection, the portfolio page uses built-in sample data and a “Sample data” badge. Sample content is not presented as a connected account. Symbols outside the sample set keep an empty or error state.

### Alerts and events

- Alert rules cover price, news, earnings, ratings, dividends, position weight, and drawdown.
- Events & Catalysts lists earnings, macro releases, and the central-bank calendar. An event can open research with that context.
- Today combines portfolio attention, watchlist movers, alerts, upcoming events, recent research, and theses needing review.
- The events screenshot is sample data.

### Agent copilot

- Persistent sessions and streamed answers on the Pi Agent runtime. Internal synthesis sessions stay out of the visible history.
- Model and thinking level, stop/cancel, and workspace context (current symbol, current view, selected holdings).
- Markdown answers include headings, lists, tables, links, and code blocks.
- Tool activity under an answer expands name, arguments, duration, and success or failure. The source inspector shows the tool data the answer cited.
- A failed tool is reported as a gap. In the screenshots, quote tools fail when Longbridge CLI is missing; the workspace and deep research can still read delayed US quotes and candles from Yahoo Finance in that same setup.

### How the agent is put together

The kernel runs in the Electron main process. The renderer subscribes to events and projects them into the view.

- **AgentKernel:** `SessionManager` persists sessions. `RunManager` allows one run at a time and settles the run on timeout, crash, or tool failure.
- **Runtimes:** `PiRuntimeAdapter` drives Pi over JSONL / stdio RPC. `LocalRuntimeAdapter` is the deterministic path used in development and tests.
- **Sessions:** Each Folio session maps to one Pi session file. Workspace context is sent with the question and is not written into the long-lived session file.
- **Capability registry:** The single source of read-only capabilities. It generates Pi tools, drives what the UI can offer, and drives skill readiness. There is no trading capability. Profile on this run showed 20 available capabilities.
- **ProviderRouter:** Primary plus backup. Each `ProviderResult` carries provenance. The on-screen “Yahoo Finance · Delayed” label comes from that path.
- **Research synthesis:** The synthesis step writes from the bundle already fetched, and untrusted text is sanitized before it enters the prompt.
- **Credentials:** `CredentialStore` encrypts secrets with OS `safeStorage`. They are not returned to the renderer.
- **Skills:** SkillHub puts a skill index in the prompt. The agent loads a `SKILL.md` and its references later through `read_skill_resource`. Path traversal and symlink escapes are rejected.

### Skills

- A skill declares required and optional capabilities. The skills center shows Ready, Partial, and Disabled.
- A missing capability is not described as available.

### Evaluation and observability

- The evaluation center shows experiments, baselines, model comparisons, failure modes, case detail, and human feedback.
- Dimensions include task completion, tool selection and arguments, evidence/provenance, latency, failure recovery, research completeness, and decision usefulness.
- `folio-agent-v1` has 86 cases (golden, difficult, long-tail, tool-failure, regression, adversarial). `deep-research-gold-v1` is a separate deep-research gold set.
- Tracing can use LangSmith or Langfuse and is off by default. Privacy level and API keys are managed separately in Settings. Keys are not echoed in the UI.
- Pull requests use the deterministic `bun run eval:smoke` gate. The full benchmark is `bun run eval:full`, on demand or on a schedule.

### Local-first and read-only

- Sessions, research state, and credentials stay on the device by default.
- Electron runs with `contextIsolation`, `sandbox`, and `nodeIntegration: false`. IPC is whitelisted by channel.
- Product paths do not place orders.

## How It Works

```text
Yahoo Finance / Longbridge / Massive
              │
              ▼
        ProviderRouter
   primary + backup, provenance on each value
              │
              ▼
   Capability Registry (read-only)
              │
     ┌────────┼─────────────┐
     ▼        ▼             ▼
  Agent    Deep research    Product UI
  tools    + Thesis         + Skills
           + Alerts         + Compare
           + Portfolio risk + Today / Events
              │
              ▼
     Evidence-backed reports

Main-process AgentKernel
  SessionManager · RunManager
  PiRuntimeAdapter / LocalRuntimeAdapter
  SkillHub · CredentialStore
```

Providers return normalized data with provenance, capabilities expose typed operations, and product workflows consume those contracts.

## Data Sources and Other Integrations

- **Yahoo Finance:** A no-key backup for delayed US quotes and daily/weekly candles when Longbridge and Massive are not configured. Unofficial, and for personal use. See [Yahoo Finance notes](docs/yahoo-finance.md).
- **Longbridge:** The primary connector for US / HK / CN market data and the brokerage account. Optional. Without the CLI, filings, news, depth, and brokerage positions that depend on it show as unavailable. Terminal login: `longbridge auth login`.
- **Massive:** A US backup when it is configured.
- **Models:** The Pi runtime talks to a configured LLM provider, including an OpenAI-compatible local or remote endpoint. Development and offline golden paths can use the deterministic local runtime.
- **Desktop:** Electron, with a macOS arm64 package. Renderer, preload bridge, and main-process kernel are isolated.
- **Skills:** Vendored `SKILL.md` resources with references, enablement, triggers, and capability requirements.
- **Evaluation:** A local evaluation backend, or optional LangSmith / Langfuse. Engineering scores can sit next to investment outcomes. A score is not a return.

## Quick Start

### For users

Download the latest macOS build from the [Releases page](https://github.com/helsome/folio/releases). After launch:

1. The workspace is browsable immediately. Portfolio, events, and similar surfaces that are not connected show built-in content with a “Sample data” badge.
2. Configure a model provider in **Settings → LLM**. Runtime, default model, and thinking level are under **Settings → General**.
3. Open **Settings → Connections**. Yahoo Finance needs no API key and can serve delayed US quotes and candles. Connect Longbridge when you need filings, news, depth, HK/CN names, or brokerage positions.
4. Open a symbol from the watchlist, read the K-line, or start **Deep Research**.
5. Press **⌘K** to search pages and symbols.

Longbridge can also be signed in from the terminal:

```bash
longbridge auth login
```

### For developers

Prerequisites: [Bun](https://bun.sh). Live Longbridge data needs the [Longbridge CLI](https://open.longbridge.com/longbridge/longbridge-terminal/install). The Pi runtime needs an LLM provider. The deterministic local runtime does not need an external model.

> **Windows**: From a standard (non-administrator) development terminal, enable Developer Mode first (Settings → System → For developers). Otherwise, installing this repo’s workspace symlink dependencies with Bun can leave empty `node_modules` directories, omit `.bin`, or fail with `tsc not found`. Processes that already have the symlink privilege, or that run elevated, are unaffected.

```bash
git clone https://github.com/helsome/folio.git
cd folio
bun install

# Start the Electron renderer in development
bun run dev

# Deterministic local agent — no external LLM
FINAGENT_AGENT_PROVIDER=local bun run dev

# Offline demo: fall back to built-in sample data when no real provider is available
FINAGENT_AGENT_PROVIDER=local FINAGENT_DEMO_DATA=1 bun run dev
```

### Commands

| Command | Description |
| --- | --- |
| `bun run dev` | Start the Electron renderer in development |
| `bun test` | Run unit and integration tests |
| `bun run typecheck` | Typecheck every workspace package |
| `bun run build` | Build packages, renderer, preload, and main process |
| `bun run test:e2e` | Run the Electron golden-path E2E suite |
| `cd apps/electron && bun run test:typed-blocks` | In-app Copilot E2E for typed answer blocks |
| `bun run eval:smoke` | Deterministic PR-level agent regression eval |
| `bun run eval:full` | Full agent benchmark |
| `bun run release:check` | Release gates |
| `bun run release:package` | Build the macOS arm64 app, DMG, and SHA256 checksums |

Packaged artifacts are staged in `dist/release/`.

## Security and Product Boundaries

- Electron runs with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and a whitelisted preload bridge.
- API keys and custom provider credentials are encrypted in the main process with Electron `safeStorage`. The renderer cannot read them back. Logs and traces redact them by default.
- Longbridge commands use argv arrays, symbol validation, and read-only capability registration.
- Skill resource paths reject traversal and symlink escapes.
- Research reports separate “data unavailable” from negative evidence and do not fabricate missing numbers.
- Agent tracing is off by default. The standard privacy level redacts prompts, answers, arguments, and portfolio tool results. Full tracing is an explicit opt-in.
- Unsigned local builds may trigger a macOS security prompt. Signing and notarization are optional release steps.

## Project Status

Folio is in beta. The current package channel is `0.4.0-beta.2`. The repo includes the research workspace, deep research, theses, compare, discover, portfolio and risk, alerts and events, skills, the command palette, and the evaluation center in Settings.

Known limitations and release decisions are in [`docs/release-gates.md`](docs/release-gates.md) ([简体中文](docs/release-gates.zh-CN.md)) and [`docs/provider-b-decision.md`](docs/provider-b-decision.md) ([简体中文](docs/provider-b-decision.zh-CN.md)).

## Roadmap

### Near term

- More providers behind the same capability contracts.
- Better report navigation and evidence inspection.
- A valuation comparison table (CURRENT vs 5Y AVG) and target-price cards for the security workspace. See [`docs/design-comparison.md`](docs/design-comparison.md).
- More useful portfolio-aware research prompts that do not leak internal runtime instructions into the user conversation.

### Longer term

- Cross-platform packages.
- More research strategies and outcome-calibration samples.
- Richer scheduled briefs, notification channels, and custom monitoring rules.
- A contributor-friendly skill and provider extension model.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — system architecture and runtime boundaries · [简体中文](docs/architecture.zh-CN.md)
- [`docs/PRD.md`](docs/PRD.md) — product requirements and invariants (the document is in Chinese)
- [`docs/UI-SYSTEM.md`](docs/UI-SYSTEM.md) — visual system and component rules · [简体中文](docs/UI-SYSTEM.zh-CN.md)
- [`docs/longbridge-auth.md`](docs/longbridge-auth.md) — Longbridge authentication · [简体中文](docs/longbridge-auth.zh-CN.md)
- [`docs/longbridge-skill-setup.md`](docs/longbridge-skill-setup.md) — skill setup and capability coverage · [简体中文](docs/longbridge-skill-setup.zh-CN.md)
- [`docs/yahoo-finance.md`](docs/yahoo-finance.md) — delayed Yahoo Finance data · [简体中文](docs/yahoo-finance.zh-CN.md)
- [`docs/release-gates.md`](docs/release-gates.md) — release validation checklist · [简体中文](docs/release-gates.zh-CN.md)
- [`docs/EVALUATION.md`](docs/EVALUATION.md) — agent evaluation, observability, and experiments · [CI strategy](docs/EVALUATION-CI.md) · [benchmark](docs/EVALUATION-BENCHMARK.md)
- [`docs/design-comparison.md`](docs/design-comparison.md) — screen-by-screen comparison of the design source and the current implementation

## FAQ

**Can I use Folio without a Longbridge account?** Yes. Yahoo Finance supplies delayed US quotes, daily/weekly candles, and company profile. Filings, news, depth, HK/CN names, and brokerage positions need Longbridge.

**Will the agent invent numbers?** A failed tool should be reported as a gap. In the screenshots above, quote tools all fail when Longbridge is not installed, and the answer does not state a price.

**Does “partial run” mean the research failed?** No. Failed capabilities are labeled, the report is still produced, and confidence stays conservative.

**Where are API keys stored?** The main process encrypts them with OS safeStorage. The renderer can write a key and cannot read the plaintext back.

**Are the holdings in the screenshots a real account?** No. Portfolio and events are badged “Sample data”. Watchlist quotes and candles are delayed Yahoo Finance data.

## Contributing

Issues and pull requests are welcome. Before opening a change, run:

```bash
bun test
bun run typecheck
```

For a UI change that materially affects layout or interaction, include a screenshot or a short visual note.
