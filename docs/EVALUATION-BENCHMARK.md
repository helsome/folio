# Folio Agent Benchmark v1 — Dataset Reference (spec §117)

The `folio-agent-v1` dataset ships embedded with the app as
`packages/shared/src/evaluation/datasets/folio-agent-v1.ts` and is registered
in `packages/shared/src/evaluation/datasets/index.ts` (id `folio-agent-v1`,
version `1.0.0`).

## Case sources

| Source | Count | Meaning |
|---|---|---|
| `hand-authored` | 70 | Written from product scenarios; no real user data involved |
| `provider-fixture` | 8 | Provider-failure cases seeded with deterministic failure fixtures |
| `regression-bug` | 8 | Encodes a real past agent bug; highest gate weight (spec §26) |
| `real-trace` | 0 | Reserved; real traces may seed cases only after privacy cleanup (spec §24) |
| `historical-issue` | 0 | Reserved for cases reconstructed from past support issues |

## Category distribution

Per spec §23 floor targets; the floors sum to 85, so the dataset ships 86 cases
(the total sits inside the spec §22 band of 50–100; quality is prioritized over
padding toward a round number).

| Category | Cases | Floor target | Covers |
|---|---|---|---|
| market | 8 | 8–10 | Basic quote, intraday, kline, market status |
| research | 13 | 12–15 | Deep research across valuation, financials, ratings, earnings, dividends, news, events, sentiment |
| tool-selection | 10 | 10–15 | Picking the right tool set for a compound request |
| tool-arguments | 8 | 8–10 | Correct granularity/range/period arguments |
| grounded | 8 | 8–10 | Evidence-backed claims, attribution, freshness, refusal to speculate |
| strategy | 8 | 8–10 | Strategy/skill-driven reviews (value, growth, technical, earnings, event-driven, risk-review, income, comprehensive) |
| provider-failure | 8 | 8–10 | Honest disclosure, retry/fallback, partial-failure honesty |
| portfolio | 5 | 5–8 | Summary, positions, assets, cash flow, diversification |
| compare | 5 | 5 | Side-by-side comparison of two symbols |
| long-tail | 8 | 8–10 | Depth, trades, capital flow, 52-week range, calendar, EPS forecasts |
| adversarial | 5 | 5–8 | Prompt injection, stale-memory refusal, prompt-leak, false-price correction, overconfidence refusal |
| **Total** | **86** | 85–101 | |

## Difficulty definitions

- `golden` (24) — happy-path tasks a well-behaved agent must always pass.
- `difficult` (34) — multi-tool research, argument nuance, or judgment calls.
- `long_tail` (8) — infrequent but legitimate capability usage (depth, trades,
  capital flow, events, forecasts).
- `tool_failure` (7) — a provider failure is seeded; the case passes on honest
  disclosure and recovery, never on fabricated data.
- `regression` (8) — encodes a real past bug; carries the highest release-gate
  weight (spec §26).
- `adversarial` (5) — hostile or misleading prompts the agent must withstand.

## Regression cases (id → bug encoded)

| Case | Bug |
|---|---|
| `fv1-market-002` | Lowercase symbol passed to the provider instead of the normalized form |
| `fv1-market-003` | Portfolio tool used to answer a public quote |
| `fv1-market-008` | Intraday tool used when a multi-month kline range was requested |
| `fv1-research-011` | P/E (valuation ratio) fabricated from quote data |
| `fv1-research-013` | Tool loop re-polling an empty news feed |
| `fv1-toolsel-009` | Single holding quote presented as portfolio value |
| `fv1-toolargs-008` | Duplicate identical tool call to "double-check" |
| `fv1-grounded-003` | Week-old article presented as breaking/fresh news |

## Known limitations

- Prompts are English-only; localization coverage is future work.
- All cases assume the single bundled data provider (`longbridge`); provider
  *switching* behavior is not exercised beyond `allowedProviders`
  constraints.
- Long-tail and adversarial sets are small by design; they are trend
  indicators, not statistical samples (spec §8).
- `fixture` seeds are schematic (`{ provider, failure }`); the fixture execution
  contract is enforced by the runner, not by this file.
- No real user traces are included yet (privacy cleanup required first, spec §24).

## How to add a regression case

1. Reproduce the bug against the current agent and record the failing run.
2. Write a case whose `expected` **guards** the correct behavior:
   - `requiredCapabilities`: the tool(s) the agent *should* call.
   - `forbiddenCapabilities`: the wrong tool/scope the bug produced.
   - `maxToolCalls`: a budget the buggy loop/duplicate behavior would blow.
   - `expectedAnswerHint`: name the regression explicitly so reviewers and
     judges know what is being protected.
3. Set `difficulty: 'regression'` and `source: 'regression-bug'`.
4. Add the case id to the regression table above.
5. Bump the dataset `version` (spec §25) — `folio-agent-v1` becomes
   `folio-agent-v1.1`; never silently mutate an existing case.
6. Run `bun test src/evaluation/datasets` in `packages/shared` — the integrity
   tests enforce unique ids, valid capability ids, and required/forbidden
   disjointness.