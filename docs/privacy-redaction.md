# Privacy: Redaction & Telemetry Content Policy

Folio is local-first: sessions, credentials and research state stay on the
device by default. This document defines what happens whenever data *does*
leave the core runtime — kernel logs, diagnostics bundles, LangSmith/Langfuse
telemetry, evaluation artifacts, IPC error payloads, and report exports.

All rules live in one place: `packages/shared/src/privacy/` (issue #19). New
outbound boundaries must import from `@finagent/shared/privacy` instead of
growing their own regex lists.

## The single rule source

| Module | Responsibility |
| --- | --- |
| `privacy/redact-text.ts` | `redactText(text)` — string-level secret patterns (fail-closed) |
| `privacy/deep-redact.ts` | `deepRedact(value)` — deep JSON walk with secret field names, cycle/depth guards; `redactError(err)` — message + stack serialization |
| `privacy/policy.ts` | Field-name rules, account-like key shapes, `REDACTION_POLICY`, telemetry content policy |

Legacy entry points (`diagnostics/redact`, `evaluation/redactor`,
`export/privacy`, the main process `redactSecrets`) delegate to this module,
so every boundary redacts with the same rules.

## What is always redacted

No matter the privacy level, the following never leave the machine in logs,
traces, diagnostics or eval artifacts:

- Provider API keys (`sk-…`, `sk-ant-…`, `rk-/pk-/ak-…`, Google `AIza…`, Slack
  `xox…`, SendGrid `SG.…`, GitLab `glpat-…`, npm `npm_…`, LangSmith `lsv2_…`)
- AWS access keys (`AKIA…`) and secret access keys in key/value context
- `Authorization` headers (Bearer and Basic), `x-api-key` / `apiKey` /
  `api_key` fields
- JWTs and VCS tokens (`gh*…`, `github_pat_…`)
- Cookies and session tokens (`Cookie`, `Set-Cookie`, `session_token`)
- Connection-string credentials (`postgres://user:pass@…`, `redis://:pass@…`,
  `mongodb+srv://…`) — scheme and host are kept, credentials dropped
- Webhook secrets and signatures (`whsec_…`, `x-hub-signature…`)
- Private key PEM blocks
- Secrets in URL query strings and fragments (`?apikey=…`, `#token=…`)
- Long base64-ish blobs (≥40 chars with mixed case)

Redaction is **fail-closed**: if the walk hits a cycle, excessive nesting, or
an internal error, the offending node is replaced with `[REDACTED]` — a raw
payload is never emitted as a fallback. Redaction is also idempotent and
preserves observability fields (run ids, trace ids, tool names, statuses,
latencies, timestamps).

## Telemetry content policy (data minimization)

Content minimization is layered on top of secret redaction and selected via
the evaluation settings privacy level (`evaluation.privacyLevel`, persisted in
the evaluation store):

| Level | What is recorded | Use when |
| --- | --- | --- |
| `minimal` | Names, statuses, durations, counts only — no prompts, answers, or tool args/results | Most paranoid setup; still enough for latency/status dashboards |
| `standard` (default) | Prompts/answers/tool args after redaction; portfolio tool results reduced to schema summaries (shape + counts, never holdings/cash/account ids) | Default for all users |
| `full` | Complete trace content, still credential-redacted | Debugging a specific run — explicit opt-in only |

The Pi agent runtime reads the same level from the `FINAGENT_PRIVACY_LEVEL`
environment variable (`minimal|standard|full`); unknown or unset values mean
tool output keeps its raw DATA blocks locally (nothing is uploaded anyway
unless tracing is enabled).

Full-content tracing is **never** the default. To opt in for a debugging
session, set the evaluation privacy level to `full` in settings (or export
`FINAGENT_PRIVACY_LEVEL=full` before launching) and revert afterwards.

## Boundaries that apply these rules

- **Kernel/main-process logs** — `console.error` sites serialize via
  `redactError`; the main error ring buffer (`ErrorLog`) redacts message and
  stack at collection time, so stack first lines cannot echo raw error text.
- **Diagnostics support bundle** — `serializeSupportBundle` re-applies
  `redactText` to every string and stamps `redaction.applied`.
- **Evaluation artifacts** (`store.json`, run records, judge results) —
  answers/tool calls via `EvaluationRedactor` per privacy level; run and judge
  error messages are redacted before persistence.
- **IPC error payloads** — `toIpcError` redacts messages before they cross to
  the renderer.
- **Report export/share** — `redactForShare` additionally strips account-like
  numeric fields; prose and evidence pass through.
- **Credential store** — all error paths redact via the shared engine; the
  store itself only ever returns metadata to the renderer.
