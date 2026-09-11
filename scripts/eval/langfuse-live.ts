#!/usr/bin/env bun
// Live / local Langfuse smoke for Deep Research (issue #14).
//
// Always runs the production ResearchRunner. If LANGFUSE_PUBLIC_KEY/SECRET_KEY
// are set, traces are written to that host; otherwise a local mock Langfuse
// ingestion API is started so the exporter can be exercised end-to-end.
//
// A second live HTTP retrieval (SEC company feed) is attached as a retrieval
// span so the suite is not fixture-only.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createCapabilityRegistry } from '../../packages/shared/src/capabilities/index.ts';
import { LocalResearchSynthesizer } from '../../packages/shared/src/research/synthesizer-local.ts';
import { ResearchRunner } from '../../packages/shared/src/research/runner.ts';
import { fakeCap } from '../../packages/shared/src/research/test-helpers.ts';
import { RESEARCH_CAPABILITY_PLAN } from '../../packages/shared/src/research/planner.ts';
import {
  LangfuseEvaluationBackend,
  langfuseCredentialsFromEnv,
  scoresFromResearchReport,
} from '../../packages/shared/src/evaluation/langfuse/index.ts';
import { currentFolioVersion } from '../../packages/shared/src/evaluation/experiment-service.ts';

interface CapturedBatch {
  type: string;
  name?: string;
  traceId?: string;
}

async function startLocalLangfuse(): Promise<{ host: string; stop: () => void; batches: CapturedBatch[][] }> {
  const batches: CapturedBatch[][] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url);
      if (url.pathname === '/api/public/projects') return Response.json({ data: [{ id: 'local' }] });
      if (url.pathname === '/api/public/ingestion') {
        const body = (await request.json()) as {
          batch?: Array<{ type: string; body: { name?: string; id?: string; traceId?: string } }>;
        };
        batches.push(
          (body.batch ?? []).map((event) => ({
            type: event.type,
            name: event.body.name,
            traceId: typeof event.body.id === 'string' ? event.body.id : event.body.traceId,
          }))
        );
        return Response.json({ successes: body.batch ?? [], errors: [] });
      }
      if (url.pathname === '/api/public/traces') return Response.json({ data: [] });
      return new Response('not found', { status: 404 });
    },
  });
  return { host: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true), batches };
}

async function liveSecRetrieval(symbol: string): Promise<{ ok: boolean; status: number; bytes: number; url: string }> {
  const url = 'https://data.sec.gov/submissions/CIK0001045810.json';
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': 'folio-langfuse-eval/0.4 (issue-14)' },
      signal: AbortSignal.timeout(12_000),
    });
    const text = await response.text();
    return { ok: response.ok, status: response.status, bytes: text.length, url };
  } catch (error) {
    return { ok: false, status: 0, bytes: 0, url: `${url} (${error instanceof Error ? error.message : String(error)})` };
  }
}

async function main(): Promise<void> {
  const envCreds = langfuseCredentialsFromEnv();
  const local = envCreds ? undefined : await startLocalLangfuse();
  const backend = new LangfuseEvaluationBackend({
    publicKey: envCreds?.publicKey ?? 'pk-lf-local',
    secretKey: envCreds?.secretKey ?? 'sk-lf-local',
    host: envCreds?.host ?? local!.host,
  });

  const registry = createCapabilityRegistry(RESEARCH_CAPABILITY_PLAN.map((id) => fakeCap(id, 'success')));
  const runner = new ResearchRunner({
    registry,
    synthesizer: new LocalResearchSynthesizer(),
  });
  const startedAt = Date.now();
  const result = await runner.run({
    symbol: 'NVDA.US',
    runId: `research-NVDA_US-${startedAt}`,
  });
  const live = await liveSecRetrieval('NVDA.US');
  const finishedAt = Date.now();

  const ref = await backend.exportResearchRun({
    folioRunId: result.summary.id,
    startedAt,
    completedAt: finishedAt,
    symbol: 'NVDA.US',
    query: 'Deep research NVDA.US',
    capabilities: [
      ...(result.report?.capabilityRuns.map((run) => ({
        capabilityId: run.capabilityId,
        status: run.status,
        startedAt: run.fetchedAt ?? startedAt,
        finishedAt: run.fetchedAt ?? finishedAt,
        error: run.error,
      })) ?? []),
      {
        capabilityId: 'research.filings.sec',
        status: live.ok ? 'success' : 'failed',
        startedAt,
        finishedAt,
        summary: live.ok ? `SEC submissions JSON ${live.bytes} bytes` : `live retrieval failed ${live.status}`,
        error: live.ok ? undefined : live.url,
        provider: 'sec.gov',
      },
    ],
    report: result.report,
    model: 'folio-local-synthesizer',
    provider: envCreds ? 'langfuse-cloud' : 'langfuse-local-mock',
    metadata: {
      folioRunId: result.summary.id,
      runKind: 'evaluation',
      goldCaseId: 'gold-nvda-deep-research',
      datasetId: 'deep-research-gold',
      datasetVersion: 'v1',
      folioVersion: currentFolioVersion(),
      model: 'folio-local-synthesizer',
      symbol: 'NVDA.US',
    },
  });

  const scores = scoresFromResearchReport(result.report, undefined, finishedAt - startedAt);
  if (ref.traceId) await backend.submitScores(ref.traceId, scores);

  const health = await backend.status();
  const artifact = {
    runId: result.summary.id,
    traceId: ref.traceId,
    traceUrl: ref.url,
    backend: envCreds ? 'langfuse-cloud' : 'langfuse-local-mock',
    host: envCreds?.host ?? local?.host,
    health,
    reportStatus: result.summary.status,
    sectionCount: result.report?.sections.length ?? 0,
    capabilityCount: result.report?.capabilityRuns.length ?? 0,
    liveRetrieval: live,
    scores,
    spanNames: local?.batches.flat().map((event) => event.name).filter(Boolean) ?? [],
  };

  const outDir = join(process.cwd(), 'artifacts');
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, 'langfuse-live-last.json');
  await writeFile(outPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

  console.log(`Eval run: ${result.summary.id}`);
  console.log(`Dataset: deep-research-gold@v1`);
  console.log(`Model: folio-local-synthesizer`);
  console.log(`Trace: ${ref.traceId}`);
  console.log(`Trace URL: ${ref.url ?? '(local mock)'}`);
  console.log(`Live SEC retrieval: ${live.ok ? `ok ${live.status} ${live.bytes}B` : `failed ${live.url}`}`);
  console.log(`Scores: ${scores.map((score) => `${score.name}=${score.value}`).join(', ')}`);
  console.log(`Artifact: ${outPath}`);

  local?.stop();
  if (!health.available && envCreds) {
    process.exitCode = 1;
  }
}

await main();
