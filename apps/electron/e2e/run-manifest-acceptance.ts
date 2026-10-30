/**
 * Live acceptance for #21 — immutable run manifests for Deep Research.
 *
 * Proves the two acceptance items that cannot be satisfied by fixtures:
 *
 *  1. Two REAL production Deep Research runs, with a deliberately changed
 *     config (model + budget), and a diff that reflects exactly that change.
 *  2. The two manifests, the diff output, and a Run Info read-back AFTER a
 *     restart (a second, fresh process whose *current* globals differ) — the
 *     historical run must still report the config it was born with.
 *
 * Real components only, no fixtures:
 *  - real `AgentKernel` + `ResearchService` (the production research path);
 *  - real DeepSeek HTTP streaming — the configured model is the model asked for;
 *  - real retrieval over the public internet through the SHIPPED provider
 *    platform: the `YahooChartFinancialDataProvider` registered on the real
 *    `ProviderRouter`, its fetchers handed to `createFullRegistry` — the same
 *    wiring `AgentKernelHost` uses. Capability bodies (validation,
 *    sanitisation, summaries, provenance) run unchanged, and every result
 *    carries the provider that actually answered plus its `delayed` flag;
 *  - a second process for the restart read-back, so nothing is served from the
 *    first process's memory.
 *
 * Retrieval scope is exactly what the shipped Yahoo adapter supports: US
 * delayed quotes, daily candles, and a thin company profile. It is a no-key,
 * unofficial chart endpoint (personal use, may rate-limit). Everything else —
 * broker positions, financials, news, options, intraday — has no provider on
 * this machine and fails loudly through the router instead of being faked with
 * zeros or empty lists. See `docs/yahoo-finance.md`.
 *
 * Usage (from the repository root, with DEEPSEEK_API_KEY in the environment):
 *   bun apps/electron/e2e/run-manifest-acceptance.ts
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentRuntime, AgentEvent, AgentRunInput, RunManifestContext } from '@finagent/core';
import { AgentKernel } from '../../../packages/shared/src/kernel/agent-kernel';
import { ResearchService } from '../../../packages/shared/src/research/service';
import { ResearchReportRepository } from '../../../packages/shared/src/research/repository';
import { JsonFileStore } from '../../../packages/shared/src/storage/json-file-store';
import { createFullRegistry } from '../../../packages/shared/src/capabilities';
import { parseSynthesisJson } from '../../../packages/shared/src/research/agent-synth';
import { ProviderRouter, createRouterFetchers } from '../../../packages/shared/src/providers';
import { YahooChartFinancialDataProvider } from '../../../packages/shared/src/providers/yahoo';
import { YAHOO_PROVIDER_ID } from '../../../packages/shared/src/providers/yahoo/adapter';
import {
  diffRunManifests,
  exportRunManifest,
  hashManifestInput,
} from '../../../packages/shared/src/kernel/run-manifest';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SYMBOL = process.env.FINAGENT_MANIFEST_SYMBOL ?? 'NVDA.US';
const STRATEGY = 'comprehensive';
const MAX_TOKENS = 8_000;

/** The deliberate configuration change between the two runs. */
const RUN_A = { label: 'run-a', model: 'deepseek-flash', budget: { modelCalls: 3 } };
const RUN_B = { label: 'run-b', model: 'deepseek-v4-pro', budget: { modelCalls: 6 } };
/** The "current globals" the restart read-back sees — deliberately != RUN_A. */
const RESTART_CURRENT_MODEL = 'deepseek-v4-pro';

const PROMPT_VERSION = 'deep-research-synthesis@1';
const PROMPT_SOURCE = 'e2e-acceptance';

const output = resolve(
  process.env.FINAGENT_MANIFEST_OUTPUT ?? 'apps/electron/e2e/artifacts/run-manifest-acceptance'
);

// ---------------------------------------------------------------------------
// Small file helpers
// ---------------------------------------------------------------------------

const save = (name: string, value: unknown) =>
  writeFile(join(output, name), JSON.stringify(value, null, 2));
const json = async (name: string) => JSON.parse(await readFile(join(output, name), 'utf8'));

async function until<T>(read: () => Promise<T | undefined>, timeout = 420_000): Promise<T> {
  const end = Date.now() + timeout;
  let last: unknown;
  while (Date.now() < end) {
    try {
      const result = await read();
      if (result) return result;
    } catch (error) {
      last = error;
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await Bun.sleep(50);
  }
  throw new Error(`Live acceptance timed out. Last error: ${String(last)}`);
}

function launch(args: string[]) {
  const log = openSync(join(output, 'worker.log'), 'a');
  try {
    return spawn(process.execPath, [import.meta.path, ...args], {
      stdio: ['ignore', log, log],
      windowsHide: true,
      env: process.env,
    });
  } finally {
    closeSync(log);
  }
}

// ---------------------------------------------------------------------------
// Real retrieval: the shipped Yahoo provider behind the real provider router
// ---------------------------------------------------------------------------

/**
 * Build the same retrieval stack `AgentKernelHost` builds: register the real
 * `YahooChartFinancialDataProvider` on a real `ProviderRouter`, point the
 * routing at it, and let `createRouterFetchers` produce the capability
 * fetchers. No hand-rolled HTTP, no hand-written mapping: quote / kline /
 * profile go through the router and the capability bodies, so the provider id,
 * the timestamp and the `delayed` flag in every result are the ones that
 * actually answered.
 *
 * Yahoo is the only market-data provider on this machine (the Longbridge CLI is
 * not installed, there is no Massive key), so it is the whole chain. Its
 * adapter covers US delayed quotes, daily candles and a thin company profile;
 * every other capability raises `UNSUPPORTED_CAPABILITY` from the router and
 * is reported as unavailable by the research run — never as zero or "no data".
 */
function buildRetrieval() {
  const router = new ProviderRouter();
  router.register(new YahooChartFinancialDataProvider());
  router.setRouting({ primary: YAHOO_PROVIDER_ID });
  return { router, fetchers: createRouterFetchers(router) };
}

/** Routing as the manifest should record it: what the run actually used. */
function retrievalManifest(routing: { primary?: string; fallback?: string }) {
  return {
    providerId: routing.primary,
    routing: {
      primary: routing.primary,
      ...(routing.fallback ? { fallback: routing.fallback } : {}),
    },
    configured: true,
    endpoint: 'https://query1.finance.yahoo.com/v8/finance/chart/',
  };
}



/** The prompt-composition fingerprint, recorded identically for both runs. */
const PROMPT_HASH = hashManifestInput(
  ['deep-research-synthesis', PROMPT_VERSION, STRATEGY, SYMBOL, 'sections=planned-keys'].join('|')
);

// ---------------------------------------------------------------------------
// Shared worker wiring: real kernel + real research service + real manifest ctx
// ---------------------------------------------------------------------------

interface WorkerOptions {
  label: string;
  /** The model this process *requests*; recorded in the manifest. */
  model: string;
  budgetDefaults: Record<string, number>;
}

function buildStack(options: WorkerOptions) {
  const { router, fetchers } = buildRetrieval();
  const routing = router.getRouting();
  const registry = createFullRegistry(fetchers);
  const repository = new ResearchReportRepository(new JsonFileStore(join(output, 'store')));

  const abort = new AbortController();
  let sequence = 0;
  const event = (input: AgentRunInput, type: string, payload: unknown = {}) =>
    ({
      id: randomUUID(),
      sessionId: input.sessionId,
      runId: input.runId,
      sequence: (sequence += 1),
      timestamp: Date.now(),
      type,
      payload,
    }) as AgentEvent;

  /** The real model call: DeepSeek HTTP streaming, nothing stubbed. */
  const runtime: AgentRuntime = {
    async getTools() {
      return { ok: true, data: [] };
    },
    async ensureSession(session) {
      return { sessionId: session.id, status: 'active' };
    },
    async cancel() {
      abort.abort();
    },
    async dispose() {
      abort.abort();
    },
    async *run(input) {
      const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + process.env.DEEPSEEK_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: options.model,
          stream: true,
          stream_options: { include_usage: true },
          response_format: { type: 'json_object' },
          max_tokens: MAX_TOKENS,
          messages: [{ role: 'user', content: input.content }],
        }),
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(300_000)]),
      });
      if (!response.ok || !response.body) {
        throw new Error('DeepSeek returned HTTP ' + response.status);
      }
      yield event(input, 'message_started');
      let answer = '';
      let buffer = '';
      let apiModel: string | undefined;
      const decoder = new TextDecoder();
      // Reader loop rather than `for await`: the repository tsconfig ships no
      // `DOM.AsyncIterable` lib, so async-iterating a ReadableStream is a type error.
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
          const part = JSON.parse(line.slice(6)) as {
            model?: string;
            usage?: unknown;
            choices?: Array<{ delta?: { content?: string } }>;
          };
          // The model the API actually served — recorded as evidence that the
          // configured model is the one that ran, not merely the one requested.
          if (part.model && !apiModel) apiModel = part.model;
          if (part.usage) {
            await save(`model-usage-${options.label}.json`, { requested: options.model, apiModel, usage: part.usage });
          }
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
    // #17: the budget the manifest must record as "what this run obeyed".
    budgets: { defaults: options.budgetDefaults },
  });

  // Real tool snapshot, derived from the real registry the research plan uses.
  const tools = registry.list().map((capability) => ({
    name: capability.toolName,
    capability: capability.id,
    enabled: true,
  }));

  const service = new ResearchService({
    registry,
    repository,
    budgets: { defaults: options.budgetDefaults },
    getIdentity: async () => ({ provider: 'deepseek', model: options.model, config: 'live-http-acceptance' }),
    // #21: the immutable snapshot. A new process rebuilds this from *its own*
    // current globals — which is exactly what the restart read-back tests.
    getRunManifestContext: async (): Promise<RunManifestContext> => ({
      runtimeMode: 'pi',
      appVersion: process.env.FINAGENT_ACCEPTANCE_APP_VERSION ?? '0.0.0-acceptance',
      buildVersion: process.env.FINAGENT_ACCEPTANCE_APP_VERSION ?? '0.0.0-acceptance',
      gitRevision: process.env.FINAGENT_ACCEPTANCE_GIT_REVISION,
      provider: 'deepseek',
      model: options.model,
      modelParams: {
        api: 'openai-completions',
        baseUrl: 'https://api.deepseek.com',
        maxTokens: MAX_TOKENS,
        reasoning: false,
      },
      prompt: { hash: PROMPT_HASH, version: PROMPT_VERSION, source: PROMPT_SOURCE },
      tools,
      // Recorded from the live router, not hard-coded: the manifest must name
      // the provider that actually serves retrieval for this run.
      search: retrievalManifest(routing),
      featureFlags: { runtimeProvider: 'pi', demoData: false, langfuseTracing: false },
      locale: 'en-US',
    }),
    synthesizer: {
      async synthesize(input) {
        const session = await kernel.sessions.createSession('Run manifest acceptance');
        const prompt = [
          `Analyze only these saved facts for ${SYMBOL}. Return JSON with summary, stance (bullish/bearish/neutral), confidence (0..1),`,
          'sections (key/title/verdict/summary), bullCase, bearCase, catalysts, risks (string arrays).',
          'Every planned key must have exactly one section. Missing data means verdict unavailable. Do not invent facts.',
          'Section verdict must be positive, negative, neutral or unavailable. State data gaps. Respond in English.',
          'Planned keys: ' + input.plannedCapabilities.join(', '),
          'Outcomes: ' + JSON.stringify(input.runs),
          'Saved facts: ' + input.dataBundle,
        ].join('\n');

        let unsubscribe = () => {};
        const result = new Promise<string>((resolveAnswer, reject) => {
          unsubscribe = kernel.runs.subscribe((agentEvent) => {
            if (agentEvent.sessionId !== session.id) return;
            if (agentEvent.type === 'run_completed') resolveAnswer(agentEvent.payload.answer ?? '');
            if (agentEvent.type === 'run_failed') reject(new Error(agentEvent.payload.error.message));
          });
        });
        void result.catch(() => {});
        try {
          const run = await kernel.runs.startRun(session.id, prompt);
          await input.recovery?.onAgentRun(run.id, session.id);
          return parseSynthesisJson(await result);
        } finally {
          unsubscribe();
        }
      },
    },
  });

  return { service, kernel, fetchers };
}

// ---------------------------------------------------------------------------
// Worker modes
// ---------------------------------------------------------------------------

async function runWorker(options: WorkerOptions): Promise<void> {
  assert.ok(process.env.DEEPSEEK_API_KEY, 'Set DEEPSEEK_API_KEY. No fixture fallback.');
  const { service, kernel, fetchers } = buildStack(options);

  const queued = await service.start(SYMBOL, STRATEGY);
  const done = await until(async () => {
    const current = await service.getRun(queued.id);
    return current && ['completed', 'partial', 'failed', 'cancelled', 'interrupted'].includes(current.status)
      ? current
      : undefined;
  });
  while (kernel.runs.isRunning()) await Bun.sleep(20);

  const manifest = (await service.getRun(queued.id))?.manifest;
  assert.ok(manifest, 'The production research run produced no manifest');

  // Who actually answered, straight off the same fetcher chain the run used.
  // Recorded so the report can show a real provider + timestamp + delayed flag
  // instead of asserting "Yahoo" from the wiring alone. A failure is recorded
  // as a failure — never papered over with a zero.
  const marketSource = await fetchers
    .getQuote(SYMBOL)
    .then((quote) => {
      const source = (quote as { source?: Record<string, unknown> }).source;
      return {
        ok: true as const,
        symbol: quote.symbol,
        lastPrice: quote.lastPrice,
        timestamp: quote.timestamp,
        ...source,
      };
    })
    .catch((error: unknown) => ({ ok: false as const, error: String(error) }));

  await save(`${options.label}.json`, {
    label: options.label,
    requestedModel: options.model,
    budgetDefaults: options.budgetDefaults,
    researchRunId: queued.id,
    status: done.status,
    completedCapabilities: done.completedCapabilities,
    failedCapabilities: done.failedCapabilities,
    marketSource,
    manifest,
  });
  await kernel.dispose();
}

async function inspectWorker(runId: string, currentModel: string): Promise<void> {
  // A brand-new process: nothing is inherited from the run that wrote it.
  // Its "current globals" deliberately name a *different* model.
  const { service, kernel } = buildStack({
    label: 'restart',
    model: currentModel,
    budgetDefaults: { modelCalls: 99 },
  });

  const historical = await service.getRun(runId);
  assert.ok(historical?.manifest, 'The historical run had no persisted manifest after restart');

  await save('run-info-after-restart.json', {
    readIn: 'fresh process (simulated app restart)',
    currentGlobalModel: currentModel,
    researchRunId: runId,
    status: historical.status,
    manifest: historical.manifest,
  });
  await kernel.dispose();
}

// ---------------------------------------------------------------------------
// Parent orchestrator
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  assert.ok(process.env.DEEPSEEK_API_KEY, 'Set DEEPSEEK_API_KEY. No fixture fallback.');
  await mkdir(output, { recursive: true });

  // Guard against reusing a previous execution's artifacts.
  try {
    await readFile(join(output, 'verification.json'));
    throw new Error('Use a fresh FINAGENT_MANIFEST_OUTPUT directory.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const runChild = async (args: string[], artifact: string) => {
    const child = launch(args);
    let spawnError: Error | undefined;
    child.on('error', (error) => {
      spawnError = error;
    });
    // Attach the exit listener *before* waiting on the artifact: a child that
    // writes its artifact and exits immediately would otherwise emit `exit`
    // before we start listening, and `once` would never resolve.
    const exited = once(child, 'exit');
    const artifactResult = await until(async () => {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null && child.exitCode !== 0) {
        throw new Error(`Worker "${args.join(' ')}" exited with ${child.exitCode}; see worker.log`);
      }
      return json(artifact);
    });
    const [code] = await exited;
    assert.equal(code, 0, `Worker "${args.join(' ')}" failed`);
    return artifactResult;
  };

  const recordA = await runChild(
    ['run', RUN_A.label, RUN_A.model, JSON.stringify(RUN_A.budget)],
    `${RUN_A.label}.json`
  );
  const recordB = await runChild(
    ['run', RUN_B.label, RUN_B.model, JSON.stringify(RUN_B.budget)],
    `${RUN_B.label}.json`
  );

  // "Restart": a fresh process whose current globals differ from run A.
  const readback = await runChild(
    ['inspect', recordA.researchRunId, RESTART_CURRENT_MODEL],
    'run-info-after-restart.json'
  );

  const manifestA = recordA.manifest;
  const manifestB = recordB.manifest;
  const diff = diffRunManifests(manifestA, manifestB);

  // --- Assertions: the manifest reflects the deliberate change -------------
  assert.notEqual(manifestA.runId, manifestB.runId, 'The two runs must have distinct identities');
  assert.equal(manifestA.model, RUN_A.model);
  assert.equal(manifestB.model, RUN_B.model);
  assert.equal(manifestA.runId, recordA.researchRunId, 'The manifest must carry the run identity');
  assert.equal(manifestA.strategy?.id, STRATEGY, 'The research strategy must be recorded');
  assert.equal(diff.changed, true, 'The deliberate config change must show as a diff');
  assert.equal(diff.groups.model, true, 'The diff must flag the model dimension');

  const modelField = diff.fields.find((field) => field.path === 'model');
  assert.ok(modelField, 'The diff must contain the model field');
  assert.equal(modelField.before, RUN_A.model);
  assert.equal(modelField.after, RUN_B.model);
  // The budget change is a real config change too (#17 integration).
  const budgetField = diff.fields.find((field) => field.path === 'budget.effective.modelCalls');
  assert.ok(budgetField, 'The diff must contain the effective model-call budget');
  assert.equal(budgetField.before, RUN_A.budget.modelCalls);
  assert.equal(budgetField.after, RUN_B.budget.modelCalls);
  // Nothing else changed: the prompt composition was identical across runs.
  assert.equal(diff.groups.prompt, false, 'An unchanged prompt must not be reported as a diff');

  // --- Assertion: the restart read-back shows the ORIGINAL config ----------
  assert.equal(
    readback.currentGlobalModel,
    RESTART_CURRENT_MODEL,
    'The restart process must have different current globals'
  );
  assert.equal(
    readback.manifest.model,
    RUN_A.model,
    'After restart the historical run must still report its own model, not the current global'
  );
  assert.notEqual(
    readback.manifest.model,
    readback.currentGlobalModel,
    'The read-back must not be served from the restarting process globals'
  );

  // --- Assertion: no credential ever reaches a manifest --------------------
  const serialized = JSON.stringify([manifestA, manifestB, readback.manifest]);
  assert.equal(
    serialized.includes(process.env.DEEPSEEK_API_KEY!),
    false,
    'A credential must never appear in a manifest'
  );

  // --- Assertion: the manifest names the provider that actually served ------
  assert.equal(
    manifestA.search?.providerId,
    YAHOO_PROVIDER_ID,
    'The manifest must record the retrieval provider the run actually used'
  );
  assert.equal(manifestA.search?.routing?.primary, YAHOO_PROVIDER_ID);
  assert.equal(
    recordA.marketSource.ok,
    true,
    'The retrieval probe must return real data — a configured connection is not proof of a successful fetch'
  );
  assert.equal(
    recordA.marketSource.providerId,
    YAHOO_PROVIDER_ID,
    'The quote must carry the answering provider'
  );
  assert.equal(recordA.marketSource.delayed, true, 'This provider serves delayed US quotes and must say so');
  assert.ok(recordA.marketSource.timestamp > 0, 'The quote must carry the provider timestamp');

  const verification = {
    kind: 'live',
    transport: 'real DeepSeek HTTP streaming; real provider-router retrieval',
    retrieval: {
      wiring: 'YahooChartFinancialDataProvider → ProviderRouter → createRouterFetchers → createFullRegistry',
      provider: YAHOO_PROVIDER_ID,
      routing: manifestA.search?.routing,
      endpoint: manifestA.search?.endpoint,
      supported: ['market.quote', 'market.kline', 'company.profile'],
      unsupported:
        'every other capability raises UNSUPPORTED_CAPABILITY from the router and is reported unavailable — never zero, never an empty event list',
      caveat: 'no-key unofficial chart host, personal use, may rate-limit',
    },
    // What actually answered, per run: provider id, timestamp, delayed flag.
    marketSource: { runA: recordA.marketSource, runB: recordB.marketSource },
    symbol: SYMBOL,
    strategy: STRATEGY,
    runs: [
      {
        label: RUN_A.label,
        researchRunId: recordA.researchRunId,
        status: recordA.status,
        requestedModel: RUN_A.model,
        manifestModel: manifestA.model,
        manifestRunId: manifestA.runId,
        completedCapabilities: recordA.completedCapabilities,
        failedCapabilities: recordA.failedCapabilities,
      },
      {
        label: RUN_B.label,
        researchRunId: recordB.researchRunId,
        status: recordB.status,
        requestedModel: RUN_B.model,
        manifestModel: manifestB.model,
        manifestRunId: manifestB.runId,
        completedCapabilities: recordB.completedCapabilities,
        failedCapabilities: recordB.failedCapabilities,
      },
    ],
    deliberateChange: {
      model: { before: RUN_A.model, after: RUN_B.model },
      budgetModelCalls: { before: RUN_A.budget.modelCalls, after: RUN_B.budget.modelCalls },
    },
    diff: {
      changed: diff.changed,
      groups: diff.groups,
      fieldCount: diff.fields.length,
      paths: diff.fields.map((field) => field.path),
    },
    restartReadback: {
      process: 'fresh process',
      currentGlobalModel: readback.currentGlobalModel,
      historicalModel: readback.manifest.model,
      historicalRunId: readback.manifest.runId,
      preserved: readback.manifest.model === RUN_A.model,
    },
    secretScan: { apiKeyPresentInManifests: serialized.includes(process.env.DEEPSEEK_API_KEY!) },
  };

  await save('run-a-manifest.json', manifestA);
  await save('run-b-manifest.json', manifestB);
  await save('manifest-diff.json', diff);
  await save('run-a-manifest-export.json', JSON.parse(exportRunManifest(manifestA)));
  await save('verification.json', verification);
  console.log(JSON.stringify(verification, null, 2));
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

const [mode, arg1, arg2, arg3] = process.argv.slice(2);
if (mode === 'run') {
  await runWorker({
    label: arg1,
    model: arg2,
    budgetDefaults: JSON.parse(arg3 ?? '{}') as Record<string, number>,
  });
  process.exit(0);
} else if (mode === 'inspect') {
  await inspectWorker(arg1, arg2);
  process.exit(0);
} else {
  await main();
}
