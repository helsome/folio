// Opt-in live quote acceptance for #101.
//
// This is intentionally not a fixture, shim, fake provider, or hand-built
// structured result. It starts the real Pi RPC runtime with the repository's
// Finagent extension, asks the model to call get_quote, and checks the real
// tool result that RunManager persists as financialEvidence. A fresh
// MessageRepository instance then proves the evidence survives reload.
//
// Required environment:
//   - A real Pi model credential (for example ANTHROPIC_API_KEY or
//     ANTHROPIC_AUTH_TOKEN, plus ANTHROPIC_MODEL when needed).
//   - An authenticated Longbridge CLI (`longbridge auth status`) because the
//     production Pi extension uses the configured Longbridge provider.
//
// Optional:
//   FINAGENT_QUOTE_ACCEPTANCE_OUTPUT — fresh artifact directory
//   FINAGENT_PI_COMMAND — Pi launcher (defaults to the current Bun executable)
//   FINAGENT_PI_PROVIDER / FINAGENT_PI_MODEL — model selection overrides
//
// Example from the repository root:
//   bun apps/electron/e2e/quote-provenance-live-acceptance.ts

import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { platform, release } from 'node:os';
import type { AgentEvent } from '@finagent/core';
import { AgentKernel } from '../../../packages/shared/src/kernel/agent-kernel.ts';
import { JsonFileStore } from '../../../packages/shared/src/storage/json-file-store.ts';
import { MessageRepository } from '../../../packages/shared/src/storage/message-repository.ts';

const repoRoot = resolve('.');
const output = resolve(
  process.env.FINAGENT_QUOTE_ACCEPTANCE_OUTPUT
    ?? join('apps/electron/e2e/artifacts/quote-provenance-live', `run-${Date.now()}`)
);
const storageDir = join(output, 'store');
const piSessionDir = join(output, 'pi-sessions');
const symbol = 'AAPL.US';
const question = [
  'Use the get_quote finance tool exactly once for AAPL.US.',
  'Do not call any other finance or web tool.',
  'Report the returned last price and identify the actual data provider, canonical instrumentId,',
  'retrievedAt and asOf timestamps, and delayed/stale flags.',
  'Use only the tool result; do not invent or estimate missing fields.',
].join(' ');

const modelProvider = process.env.FINAGENT_PI_PROVIDER ?? 'anthropic';
const model = process.env.FINAGENT_PI_MODEL ?? process.env.ANTHROPIC_MODEL;
const hasModelCredential = Boolean(
  process.env.ANTHROPIC_API_KEY
    || process.env.ANTHROPIC_AUTH_TOKEN
    || process.env.OPENAI_API_KEY
    || process.env.FINAGENT_PROVIDER_OVERRIDES
);
assert.ok(
  hasModelCredential,
  'No live Pi model credential found. Set ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, OPENAI_API_KEY, or FINAGENT_PROVIDER_OVERRIDES.'
);

await mkdir(storageDir, { recursive: true });
await mkdir(piSessionDir, { recursive: true });

const piCommand = process.env.FINAGENT_PI_COMMAND ?? process.execPath;
const piArgs = [
  ...(piCommand.toLowerCase().endsWith('bun.exe') ? ['x'] : []),
  '@mariozechner/pi-coding-agent',
  '--mode',
  'rpc',
  '--provider',
  modelProvider,
  ...(model ? ['--model', model] : []),
  '--extension',
  resolve('.pi/extensions/finagent/index.ts'),
  '--session-dir',
  piSessionDir,
];

const runtimeEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  // DeepSeek's Anthropic-compatible endpoint uses the bearer token variable;
  // Pi's Anthropic adapter reads the standard API-key variable.
  ...(process.env.ANTHROPIC_API_KEY || !process.env.ANTHROPIC_AUTH_TOKEN
    ? {}
    : { ANTHROPIC_API_KEY: process.env.ANTHROPIC_AUTH_TOKEN }),
});

const kernel = new AgentKernel({
  provider: 'pi-runtime',
  storageDir,
  piSessionDir,
  rpc: {
    command: piCommand,
    args: piArgs,
    cwd: repoRoot,
    env: runtimeEnv,
    requestTimeoutMs: 240_000,
    healthTimeoutMs: 120_000,
    singleToolTimeoutMs: 60_000,
  },
});

const events: AgentEvent[] = [];
const unsubscribe = kernel.runs.subscribe((event) => events.push(event));
const session = await kernel.sessions.createSession('Live quote provenance acceptance');
const run = await kernel.runs.startRun(session.id, question);

try {
  const deadline = Date.now() + 360_000;
  while (Date.now() < deadline && !events.some((event) =>
    event.runId === run.id && (event.type === 'run_completed' || event.type === 'run_failed')
  )) {
    await Bun.sleep(1_000);
  }

  const terminal = events.find((event) =>
    event.runId === run.id && (event.type === 'run_completed' || event.type === 'run_failed')
  );
  assert.ok(terminal, `Live quote run ${run.id} did not finish before the deadline.`);
  if (terminal.type === 'run_failed') {
    throw new Error(`Live quote run failed: ${terminal.payload.error.message}`);
  }

  const messages = await kernel.sessions.listMessages(session.id);
  const assistant = [...messages].reverse().find((message) => message.role === 'assistant');
  assert.ok(assistant, 'No persisted assistant message was produced.');
  const quoteCall = (assistant.toolCalls ?? []).find((call) =>
    call.toolName === 'get_quote' && call.status === 'success'
  );
  assert.ok(quoteCall, 'The real Pi answer did not complete a successful get_quote call.');

  const structured = readRecord(quoteCall.result);
  const data = readRecord(structured.data);
  const provenance = readRecord(structured.provenance);
  const evidence = assistant.financialEvidence?.find((entry) => entry.toolCallId === quoteCall.id);
  assert.ok(evidence, 'The successful get_quote call produced no persisted financialEvidence.');

  const provider = stringValue(provenance.providerId) ?? stringValue(provenance.provider);
  assert.ok(provider && provider !== 'demo', `Expected a configured live provider, got ${provider ?? 'missing'}.`);
  assert.equal(provider, 'longbridge', 'This live acceptance is configured for the Longbridge provider.');
  const instrumentId = stringValue(provenance.instrumentId) ?? evidence.instrumentId;
  assert.ok(instrumentId, 'The live quote result did not expose a canonical instrumentId.');
  assert.match(instrumentId, /^[A-Z]{4}:[A-Z0-9.]+$/, 'instrumentId is not canonical MIC:symbol form.');

  const retrievedAt = numberValue(provenance.fetchedAt) ?? evidence.retrievedAt;
  const asOf = numberValue(provenance.marketTime) ?? evidence.asOf;
  assert.ok(retrievedAt !== undefined, 'Live quote did not expose retrievedAt in epoch milliseconds.');
  assert.ok(asOf !== undefined, 'Live quote did not expose asOf in epoch milliseconds.');

  // Stop the Pi process before opening a fresh repository instance. The
  // message itself is already durable when RunManager reports completion.
  await kernel.dispose();
  unsubscribe();
  const reloaded = await new MessageRepository(new JsonFileStore(storageDir)).list(session.id);
  const reloadedEvidence = [...reloaded].reverse()
    .find((message) => message.role === 'assistant')?.financialEvidence
    ?.find((entry) => entry.toolCallId === quoteCall.id);
  assert.deepEqual(reloadedEvidence, evidence, 'Reloaded financialEvidence differs from the persisted record.');

  const resultSummary = {
    symbol: data.symbol,
    lastPrice: data.lastPrice,
    change: data.change,
    changePercent: data.changePercent,
    volume: data.volume,
  };
  const verification = {
    mode: 'live Pi RPC + real model + real Longbridge provider + persisted evidence reload',
    head: readHead(),
    environment: {
      bun: Bun.version,
      os: `${platform()} ${release()}`,
      modelProvider,
      model: model ?? '<Pi default>',
      piCommand,
      piArgs: piArgs.map((arg) => arg === piCommand ? '<redacted>' : arg),
    },
    command: 'bun apps/electron/e2e/quote-provenance-live-acceptance.ts',
    query: question,
    sessionId: session.id,
    runId: run.id,
    toolId: quoteCall.id,
    toolName: quoteCall.toolName,
    provider,
    providerName: stringValue(provenance.providerName),
    resultSummary,
    instrumentId,
    asOf: { value: asOf, unit: 'epoch milliseconds' },
    retrievedAt: { value: retrievedAt, unit: 'epoch milliseconds' },
    delayed: booleanValue(provenance.delayed) ?? evidence.delayed ?? false,
    stale: booleanValue(provenance.stale) ?? evidence.stale,
    answer: terminal.payload.answer,
    financialEvidence: evidence,
    reloadMatches: true,
  };
  await writeFile(join(output, 'verification.json'), JSON.stringify(verification, null, 2), 'utf8');
  console.log(JSON.stringify({
    head: verification.head,
    model: verification.environment.model,
    provider,
    runId: run.id,
    toolId: quoteCall.id,
    resultSummary,
    instrumentId,
    asOf: verification.asOf,
    retrievedAt: verification.retrievedAt,
    delayed: verification.delayed,
    stale: verification.stale,
    reloadMatches: true,
    artifacts: output,
  }, null, 2));
  console.log('\nLive quote provenance acceptance PASSED.');
} finally {
  unsubscribe();
  await kernel.dispose().catch(() => undefined);
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readHead(): string {
  try {
    const gitHead = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: repoRoot });
    return new TextDecoder().decode(gitHead.stdout).trim();
  } catch {
    return '<unknown>';
  }
}
