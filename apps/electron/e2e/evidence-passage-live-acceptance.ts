// Live, opt-in Deep Research E2E for passage-level evidence location (#13).
//
// Runs the PRODUCTION path end to end: a real model drives the real AgentKernel
// through the real `createAgentSynthesizer`, the real `research.news` capability
// performs real network retrieval, and the real `ResearchService`/`ResearchRunner`
// assembles the report. Nothing is fixture-backed: no LocalResearchSynthesizer,
// no canned capability, no pre-seeded run.
//
// What it proves — the slice this PR owns:
//   1. real retrieval produces `ResearchReport.evidencePassages`;
//   2. every recorded offset relocates to the exact same position in the real
//      source text, and slicing that range returns the recorded excerpt, so a
//      claim → source jump lands on the passage rather than the front page;
//   3. every `EvidenceRef` resolves to at least one passage (evidence → passage);
//   4. the passages survive persistence: a fresh repository instance reads the
//      same report and every passage still relocates.
//
// It does NOT prove the full #13 claim→verifier chain. Claim identity and the
// bidirectional claim↔evidence mapping land in separate PRs, and the verifier
// (#90) is a standalone library not yet wired into the report path. Those are
// out of scope here and are reported as such.
//
// Retrieval: the production `research.news` capability is used as-is; only its
// `getNews` fetcher is injected. With `FINAGENT_EVIDENCE_NEWS_FEED` set it reads
// a live public RSS feed over HTTPS; without it, the production Longbridge
// fetcher is used (which needs the Longbridge CLI installed and authenticated).
//
// Env:
//   DEEPSEEK_API_KEY            real model credential (required, no fallback)
//   FINAGENT_EVIDENCE_NEWS_FEED live RSS feed URL used as the retrieval source
//   FINAGENT_EVIDENCE_OUTPUT    artifact dir (default apps/electron/e2e/artifacts/evidence-passage)
//   FINAGENT_EVIDENCE_MODEL     model id (default deepseek-chat)
//   FINAGENT_EVIDENCE_SYMBOL    symbol to research (default NVDA.US)
//   FINAGENT_EVIDENCE_MODEL_URL chat-completions endpoint (default https://api.deepseek.com/chat/completions;
//                               override for a gateway/proxy, mirroring FINAGENT_JUDGE_BASE_URL)
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  AgentEvent,
  AgentRunInput,
  AgentRuntime,
  NewsItem,
} from '@finagent/core';
import { AgentKernel } from '../../../packages/shared/src/kernel/agent-kernel';
import { ResearchService } from '../../../packages/shared/src/research/service';
import { ResearchReportRepository } from '../../../packages/shared/src/research/repository';
import { JsonFileStore } from '../../../packages/shared/src/storage/json-file-store';
import { createCapabilityRegistry } from '../../../packages/shared/src/capabilities';
import { createResearchNewsCapability } from '../../../packages/shared/src/capabilities/manifests/research-news';
import { defaultCapabilityFetchers } from '../../../packages/shared/src/capabilities/fetchers';
import { createAgentSynthesizer, parseSynthesisJson } from '../../../packages/shared/src/research/agent-synth';
import { passagesForEvidence, relocatePassage } from '../../../packages/shared/src/research/evidence-passage';

const output = resolve(process.env.FINAGENT_EVIDENCE_OUTPUT ?? 'apps/electron/e2e/artifacts/evidence-passage');
const model = process.env.FINAGENT_EVIDENCE_MODEL ?? 'deepseek-chat';
const symbol = process.env.FINAGENT_EVIDENCE_SYMBOL ?? 'NVDA.US';
const modelUrl = process.env.FINAGENT_EVIDENCE_MODEL_URL ?? 'https://api.deepseek.com/chat/completions';
const newsFeed = process.env.FINAGENT_EVIDENCE_NEWS_FEED;

assert.ok(process.env.DEEPSEEK_API_KEY, 'Set DEEPSEEK_API_KEY. No fixture fallback — this acceptance must run a real model.');
await mkdir(output, { recursive: true });
const save = (name: string, value: unknown) =>
  writeFile(join(output, name), JSON.stringify(value, null, 2));

async function until<T>(read: () => Promise<T | undefined>, timeout = 300000): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await read();
    if (result !== undefined) return result;
    await Bun.sleep(50);
  }
  throw new Error('Live acceptance timed out');
}

/** The exact text a news item was retrieved as — mirrors the production rule. */
function sourceTextOf(item: NewsItem): string {
  const title = typeof item.title === 'string' ? item.title.trim() : '';
  const summary = typeof item.summary === 'string' ? item.summary.trim() : '';
  if (title.length === 0) return summary;
  return summary.length === 0 ? title : `${title}\n\n${summary}`;
}

// ── Real retrieval: a live public RSS feed over HTTPS ──────────────────────

function decodeXmlText(value: string): string {
  const unwrapped = value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  const stripped = unwrapped.replace(/<[^>]*>/g, '');
  return stripped
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .trim();
}

function tagOf(block: string, tag: string): string {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
  return match ? decodeXmlText(match[1]) : '';
}

/** Minimal RSS 2.0 reader — enough for a real headline feed, no dependency. */
function parseRssItems(xml: string): Array<{ title: string; summary: string; url: string; published: number }> {
  const blocks = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) ?? [];
  return blocks
    .map((block) => {
      const title = tagOf(block, 'title');
      const summary = tagOf(block, 'description');
      const link = tagOf(block, 'link');
      const guid = tagOf(block, 'guid');
      const published = Date.parse(tagOf(block, 'pubDate'));
      return {
        title,
        summary,
        url: link.length > 0 ? link : guid,
        published: Number.isFinite(published) ? Math.floor(published / 1000) : 0,
      };
    })
    .filter((item) => item.title.length > 0 && item.url.length > 0);
}

async function fetchFeedNews(feedUrl: string, forSymbol: string): Promise<NewsItem[]> {
  const response = await fetch(feedUrl, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`News feed returned HTTP ${response.status}`);
  const xml = await response.text();
  await writeFile(join(output, 'news-feed.xml'), xml);
  const items: NewsItem[] = parseRssItems(xml).map((item, index) => ({
    id: `feed-${index}-${item.url}`,
    title: item.title,
    summary: item.summary,
    url: item.url,
    timestamp: item.published,
    symbols: [forSymbol],
  }));
  assert.ok(items.length > 0, 'The live news feed returned no usable items');
  return items;
}

// ── Real model runtime: HTTP streaming, no local adapter ───────────────────
const abort = new AbortController();
let sequence = 0;
const event = (input: AgentRunInput, type: string, payload: unknown = {}): AgentEvent =>
  ({
    id: randomUUID(),
    sessionId: input.sessionId,
    runId: input.runId,
    sequence: ++sequence,
    timestamp: Date.now(),
    type,
    payload,
  }) as AgentEvent;

const runtime: AgentRuntime = {
  async getTools() {
    return { ok: true, data: [] };
  },
  async ensureSession(s) {
    return { sessionId: s.id, status: 'active' };
  },
  async cancel() {
    abort.abort();
  },
  async dispose() {
    abort.abort();
  },
  async *run(input) {
    const response = await fetch(modelUrl, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + process.env.DEEPSEEK_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        stream: true,
        stream_options: { include_usage: true },
        response_format: { type: 'json_object' },
        max_tokens: 6000,
        messages: [{ role: 'user', content: input.content }],
      }),
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(180000)]),
    });
    if (!response.ok || !response.body) throw new Error('Model endpoint returned HTTP ' + response.status);
    yield event(input, 'message_started');
    let answer = '';
    let buffer = '';
    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
        const part = JSON.parse(line.slice(6));
        if (part.usage) await save('model-usage.json', { model: part.model, usage: part.usage });
        const delta = part.choices?.[0]?.delta?.content;
        if (!delta) continue;
        answer += delta;
        yield event(input, 'message_delta', { delta, answer });
      }
    }
    yield event(input, 'message_completed', { answer });
    yield event(input, 'run_completed', { answer, toolCalls: [] });
  },
};

const kernel = new AgentKernel({
  storageDir: join(output, 'kernel'),
  piSessionDir: join(output, 'sessions'),
  runtime,
});

// ── The PRODUCTION news capability, with only its fetcher injected ─────────
const news = createResearchNewsCapability(
  newsFeed
    ? { ...defaultCapabilityFetchers, getNews: (requested: string) => fetchFeedNews(newsFeed, requested) }
    : defaultCapabilityFetchers,
);

// ── Production synthesizer: the real agent runner, not LocalResearchSynth ──
const synthesizer = createAgentSynthesizer(async (input) => {
  const session = await kernel.sessions.createSession('Evidence passage live acceptance');
  const prompt = [
    'Analyze only these saved facts for ' + symbol + '. Return JSON with summary, stance (bullish/bearish/neutral), confidence (0..1),',
    'sections (key/title/verdict/summary), bullCase, bearCase, catalysts, risks (string arrays).',
    'Every planned key must have exactly one section. Missing data means verdict unavailable. Do not invent facts.',
    'Section verdict must be positive, negative, neutral or unavailable. State data gaps. Respond in English.',
    'Planned keys: ' + input.plannedCapabilities.join(', '),
    'Outcomes: ' + JSON.stringify(input.runs),
    'Saved facts: ' + input.dataBundle,
  ].join('\n');
  let unsubscribe = () => {};
  const result = new Promise<string>((resolveResult, reject) => {
    unsubscribe = kernel.runs.subscribe((e) => {
      if (e.sessionId !== session.id) return;
      if (e.type === 'run_completed') resolveResult((e.payload as { answer?: string }).answer ?? '');
      if (e.type === 'run_failed') reject(new Error(String((e.payload as { error?: { message?: string } }).error?.message)));
    });
  });
  void result.catch(() => {});
  try {
    await kernel.runs.startRun(session.id, prompt);
    return parseSynthesisJson(await result);
  } finally {
    unsubscribe();
  }
});

const repository = new ResearchReportRepository(new JsonFileStore(join(output, 'store')));
const service = new ResearchService({
  registry: createCapabilityRegistry([news]),
  synthesizer,
  repository,
  getIdentity: async () => ({ provider: 'deepseek', model, config: 'evidence-passage-live-v1' }),
});

const started = await service.start(symbol);
console.log('Started live research ' + started.id + '; waiting for real retrieval, model streaming and report assembly.');

const finished = await until(async () => {
  const current = await service.getRun(started.id);
  return current && ['completed', 'partial', 'failed', 'cancelled', 'interrupted'].includes(current.status)
    ? current
    : undefined;
});
while (kernel.runs.isRunning()) await Bun.sleep(50);
await save('finished.json', finished);

assert.ok(['completed', 'partial'].includes(finished.status), 'Research run did not settle successfully: ' + finished.status);
assert.ok(finished.reportId, 'A settled run must publish a report id');

const report = await repository.getReport(finished.reportId);
assert.ok(report, 'The published report must be readable');
await save('final-report.json', report);

// The exact payload the capability returned, read from the durable checkpoint
// rather than re-derived — so the verification uses the real ingested data.
const checkpoint = await repository.getCheckpoint(started.id);
assert.ok(checkpoint, 'The durable checkpoint must be readable');
const newsOutcome = checkpoint.outcomes.find((outcome) => outcome.record.capabilityId === 'research.news');
assert.ok(newsOutcome, 'The checkpoint must record the research.news outcome');
const rawNews: unknown = newsOutcome.result?.data;
assert.ok(Array.isArray(rawNews) && rawNews.length > 0, 'The capability must have returned retrieved news items');
const items = rawNews as NewsItem[];
await save('retrieved-news.json', items);

// ── 1. Real retrieval produced passages ───────────────────────────────────
const passages = report.evidencePassages ?? [];
assert.ok(passages.length > 0, 'Real news retrieval must produce locatable passages');

// ── 2. Every offset relocates to the exact same position ──────────────────
for (const passage of passages) {
  assert.ok(passage.excerpt.trim().length > 0, 'A passage must carry a non-empty excerpt');
  assert.ok(
    passage.documentId !== undefined || passage.canonicalUrl !== undefined,
    'A passage must identify its source document',
  );
  const item = items.find((candidate) => candidate.id === passage.documentId);
  assert.ok(item, 'A passage documentId must resolve to a retrieved news item');
  const sourceText = sourceTextOf(item);
  const relocated = relocatePassage(passage, sourceText);
  assert.deepEqual(relocated, passage.location, 'Persisted offsets must relocate to the same position');
  assert.equal(
    sourceText.slice(passage.location.start, passage.location.end),
    passage.excerpt,
    'The recorded offset range must slice out exactly the recorded excerpt',
  );
  assert.ok(passage.location.line >= 1 && passage.location.column >= 1, 'line/column must be 1-based');
}

// ── 3. evidence → passage direction is usable ─────────────────────────────
const evidenceRefs = report.sections.flatMap((section) => section.evidence);
assert.ok(evidenceRefs.length > 0, 'The report must carry evidence references');
for (const evidence of evidenceRefs) {
  const linked = passagesForEvidence(passages, { runId: evidence.runId, capabilityId: evidence.capabilityId });
  assert.ok(linked.length > 0, 'Each evidence reference must resolve to at least one passage');
}

// ── 4. Passages survive persistence (fresh repository instance) ───────────
const reloadedRepository = new ResearchReportRepository(new JsonFileStore(join(output, 'store')));
const reloaded = await reloadedRepository.getReport(report.id);
assert.ok(reloaded, 'A fresh repository must read back the report');
assert.deepEqual(reloaded.evidencePassages, passages, 'Reloaded passages must be byte-identical');
for (const passage of reloaded.evidencePassages ?? []) {
  const item = items.find((candidate) => candidate.id === passage.documentId);
  assert.ok(item, 'A reloaded passage must still resolve to its source');
  assert.deepEqual(
    relocatePassage(passage, sourceTextOf(item)),
    passage.location,
    'A reloaded passage must still relocate to the same position',
  );
}

const verification = {
  mode: 'live AgentKernel + ResearchService production path; real model over HTTP; production research.news capability',
  model,
  symbol,
  retrieval: newsFeed ? { kind: 'live public RSS feed', url: newsFeed } : { kind: 'Longbridge CLI (production fetcher)' },
  runId: started.id,
  reportId: report.id,
  runStatus: finished.status,
  retrievedNewsCount: items.length,
  evidenceRefCount: evidenceRefs.length,
  passageCount: passages.length,
  allOffsetsRelocate: true,
  allEvidenceMappedToPassage: true,
  survivesReload: true,
  scope:
    'Passage-level evidence location only. Claim identity, bidirectional claim↔evidence mapping and verifier output are separate PRs and are not exercised here.',
};
await save('verification.json', verification);
console.log(JSON.stringify(verification));

await kernel.dispose();
process.exit(0);
