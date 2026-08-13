# Folio V2 — AI-native Finance Workbench: Internal Plan

## Research findings (verified against real installs)

- **Pi runtime**: repo kernel targets `bunx @mariozechner/pi-coding-agent` (latest = 0.73.1).
  RPC envelope `{id, type, params}` on stdin/stdout JSONL.
  Verified commands on 0.73.1: `get_state` (model + thinkingLevel + thinkingLevelMap),
  `get_available_models` (works; slow on first call — catalog warmup; response can arrive after
  other commands), `set_model {provider, modelId}`, `set_thinking_level {level}` (coerces to nearest
  supported level; no data in response — re-read `get_state`), `prompt`, `switch_session`, `abort`.
  `get_available_thinking_levels` NOT supported in 0.73.1 (Unknown command) → derive levels from
  `model.thinkingLevelMap` keys with non-null values + `off`.
  Custom providers: extension `registerProvider(name, {api, baseUrl, apiKey, models:[...]})` —
  full model replacement, immediate effect, Folio-owned (does not touch user's global pi config).
- **Longbridge CLI 0.17.0**: `quote`, `static` (name, total_shares, eps, dividend, currency,
  exchange), `calc-index` (pe/pb/dps_rate/total_market_value/turnover_rate), `market-status`,
  `kline`, `intraday`, `news`, `valuation`, `portfolio`, `positions` — all JSON-capable.
- **longbridge/skills**: 13 skills, MIT license, `<name>/SKILL.md` + `references/*.md` +
  `index.json` [{name,path,description,location}]. SKILL.md frontmatter: name, description
  (with trigger keywords), license, metadata{author,version,risk_level,requires_login,
  default_install,requires_mcp,tier}. ~1.2MB total.

## Architecture decisions

1. **WorkspaceContext** (UI state) vs Session (conversation state) stay separate. Runs carry an
   ephemeral `workspaceContext` through `AgentRunInput` → prompt builder. Not persisted.
2. **Single data layer**: UI and Agent both go through `MarketDataService` (IPC in main; tools in Pi).
3. **LLM control plane**: new `LlmRuntimeApi` exposed by `PiRuntimeAdapter` (listModels/setModel/
   setThinkingLevel/getState/testProvider/restart). Kernel composition unchanged; kernelHost wires
   the API to new whitelisted `llm:*` IPC channels.
4. **Credentials**: encrypted at rest in Electron main via `safeStorage`
   (`userData/credentials.json`). Secrets flow: renderer (input only) → IPC → CredentialStore →
   decrypt at Pi spawn → env `FINAGENT_PROVIDER_OVERRIDES` → pi-extension `registerProvider`.
   Secrets never cross to the renderer and are redacted in logs/errors/traces.
5. **Skills**: SkillHub V2 package loader (SKILL.md + references/ + scripts/ + assets/) with path
   safety. Progressive loading: compact metadata index goes into the system prompt at run start;
   the agent loads SKILL.md/references on demand through the `read_skill_resource` Pi tool backed
   by `FINAGENT_SKILLS_DIR` (repo `skills/` dir, vendored from longbridge/skills).
6. **Chart**: klinecharts behind `FinancialKLineChart` + `klineAdapter` (FinancialBar + MA/EMA).
   Race safety: request sequence guard, stale responses dropped.

## Slices

1. WorkbenchShell (allotment) + activeSymbol + dense Watchlist + SecurityHeader
2. FinancialKLineChart + Longbridge kline + period/symbol switching
3. AgentPanel (model/thinking selectors, context chip, tool activity) + streaming/stop regression
4. WorkspaceContext → run; Pi models RPC; Model/Thinking selectors end-to-end
5. CredentialStore + Settings (General/Models/Longbridge/Skills) + custom OpenAI-compatible provider
6. SkillHub V2 + vendored Longbridge skills + progressive references
7. Overview + structured agent components (QuoteCard/MetricGrid/PortfolioRiskCard/ToolActivity)
8. Dark finance theme, tests, E2E smoke, docs

## Build gates

`bun test` (root: `bun test` across packages), `bun run typecheck`, `bun run build` — all green at DoD.
