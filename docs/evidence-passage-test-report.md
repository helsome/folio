# Evidence passage location acceptance report

Issue #13 asks that report evidence resolve to the **actual source passage** rather than a
document-level citation, and that a claim → source jump still land on that passage after the report
is reloaded. This report covers the **passage-location slice** of that work (PR #251). Claim
identity, the verifier verdicts and the bidirectional claim↔evidence mapping are separate PRs and
are explicitly out of scope below.

## Live Deep Research E2E — PASS

Date: 2026-09-28. Environment: Windows 10.0.26200.9550, Bun 1.4.2, Node 22.22.2.
Commit under test: `bbcb4de` — `feat(research): 记录证据的原始 passage 位置，重载后仍可定位`.

Actual command, from the repository root, after loading the model credential into the process
environment:

```sh
FINAGENT_EVIDENCE_NEWS_FEED='https://rss.nytimes.com/services/xml/rss/nyt/Business.xml' \
FINAGENT_EVIDENCE_MODEL='deepseek-v4-pro' \
FINAGENT_EVIDENCE_SYMBOL='NVDA.US' \
DEEPSEEK_API_KEY=… \
bun apps/electron/e2e/evidence-passage-live-acceptance.ts
```

No fixture sits anywhere on this path — the acceptance fails closed without a model credential and
without a reachable retrieval source:

| Stage | Real component that ran |
| --- | --- |
| Retrieval | The **production** `research.news` capability (`createResearchNewsCapability`), with only its `getNews` fetcher injected to read a live HTTPS feed |
| Model | `deepseek-v4-pro` over the real streaming chat-completions API |
| Synthesis | The production `createAgentSynthesizer` driving the real `AgentKernel` |
| Assembly | The production `ResearchService` → `ResearchRunner` → `assembleReport` |
| Persistence | The real `ResearchReportRepository` over `JsonFileStore` |

| Evidence | Observed result |
| --- | --- |
| Research run | `research-064770ff-2e25-42dd-bc18-e93d72d4ff3e` |
| Published report | `report-research-064770ff-2e25-42dd-bc18-e93d72d4ff3e` |
| Run status | `partial` — news succeeded; the nine capabilities absent from the injected registry are explicitly `unavailable` |
| Retrieved articles | 49 live articles (real HTTP response body retained as `news-feed.xml` during the run) |
| Recorded passages | 49 — one per retrieved article |
| Offsets relocate | every passage re-locates to the **same** position, and `sourceText.slice(start, end)` equals the recorded excerpt |
| evidence → passage | every `EvidenceRef` resolves to at least one passage |
| Survives reload | a **fresh** repository instance reads byte-identical passages and every one still relocates |
| Model usage | 2068 prompt + 2635 completion tokens (1926 of them reasoning) |

A representative recorded passage (offsets are 0-based character offsets into
`"<title>\n\n<summary>"`, hence `line: 3, column: 1`):

```json
{
  "id": "passage:run-research.news-1790605880681-1:research.news:feed-0-https://www.nytimes.com/2026/09/28/business/nvidia-stock-buyback.html:69-226",
  "runId": "run-research.news-1790605880681-1",
  "capabilityId": "research.news",
  "documentId": "feed-0-https://www.nytimes.com/2026/09/28/business/nvidia-stock-buyback.html",
  "canonicalUrl": "https://www.nytimes.com/2026/09/28/business/nvidia-stock-buyback.html",
  "excerpt": "The increase comes four months after the chip giant added $80 billion to its buyback program, bringing the total remaining authorized amount to $235 billion.",
  "location": { "start": 69, "end": 226, "line": 3, "column": 1 }
}
```

Committed artifacts:

- [Verification record](acceptance/evidence-passage/verification.json)
- [Final model-generated report](acceptance/evidence-passage/final-report.json)
- [Retrieved news payload](acceptance/evidence-passage/retrieved-news.json)
- [Run summary](acceptance/evidence-passage/finished.json)
- [Provider-reported model usage](acceptance/evidence-passage/model-usage.json)

The report and news payload are test output, not independently verified financial analysis.

## Automated checks

| Executed command | Result |
| --- | --- |
| `bun test --isolate packages/shared/src/research packages/core --timeout 20000` | 185 pass / 0 fail; 540 assertions across 21 files |
| `tsc --noEmit` on `apps/electron/e2e/evidence-passage-live-acceptance.ts` | exit 0 |
| `tsc --noEmit` in the core, shared, i18n, ui and electron workspaces | all exit 0 |

`packages/shared` as a whole still reports 22 environment-only failures (21 Longbridge provider
tests needing an external CLI, 1 Langfuse test needing an external endpoint). An A/B run with the
production code reverted produces the identical 22, so they are unrelated to this change; the PR
body carries that baseline.

## Scope and limits

Proven by this acceptance:

- real network retrieval produces locatable passages;
- every recorded offset resolves back to the same position in the real source text, and the
  recorded excerpt is exactly the text at that range;
- the evidence → passage direction is usable;
- all of the above survives persistence and a fresh repository reload.

**Not** proven here, because the code does not exist yet:

- **claim identity** and the bidirectional `claim → evidence_refs` / `evidence_ref → claim_ids`
  mapping — PR #67, still open;
- **verifier output** — `claim-verifier.ts` (#90) merged as a standalone library with no callers;
  nothing wires it into the report path;
- **report UI bidirectional jump** — unclaimed;
- **Longbridge as the retrieval source** — see below.

Retrieval note: the acceptance environment had no Longbridge CLI and no Longbridge credentials, so
the capability's `getNews` fetcher was injected with a live public RSS feed. The production
Longbridge fetcher remains the capability's default and is exercised end to end by
`apps/electron/e2e/research-recovery-kernel.ts` (PR #80). Because `createResearchNewsCapability`
stamps `provenance.provider` as the literal `'longbridge'`, the checkpoint for this run records
`provider: "longbridge"` even though the fetcher was an RSS feed — a pre-existing quirk of the
manifest, not something this PR changes, but worth knowing before treating that field as
authoritative.

The acceptance harness is opt-in and is not part of any CI gate; it needs a real model credential
and a reachable retrieval source to run.
