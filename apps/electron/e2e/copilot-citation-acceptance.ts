// Live, opt-in Copilot citation acceptance (#30): real AgentKernel (Pi runtime,
// real model) + the real Pi-extension tool chain (finance capability tools with
// EVIDENCE lines + inline-citation instruction), answering a mixed-source
// question (structured quote + news). The only stub is the `longbridge` CLI
// transport, replaced by a fixture-replay shim on PATH — the capability
// manifests, parsers, sanitizers, and evidence-envelope builder all run for
// real.
//
// Proves the reviewer requirement: one real Copilot answer mixing at least one
// news (web) source with structured financial evidence, where inline citation
// markers resolve to actual tool-call/evidence records.
//
// Env: ANTHROPIC_API_KEY (+ ANTHROPIC_BASE_URL / ANTHROPIC_MODEL /
// FINAGENT_PI_MODEL). Exit 0 = all assertions held.
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { delimiter } from 'node:path';
import type { AgentEvent, ToolCall } from '@finagent/core';
import { CITATION_MARKER_START, parseCitationSegments } from '@finagent/core';
import { AgentKernel } from '../../../packages/shared/src/kernel/agent-kernel';
import { buildFinancialEvidence } from '../../../packages/shared/src/evidence/financial-evidence';

const here = resolve('.');
const output = resolve('apps/electron/e2e/artifacts/copilot-citation-acceptance', `run-${Date.now()}`);
const shimDir = resolve('apps/electron/e2e/artifacts/longbridge-shim');
const symbol = 'AAPL.US';
const question = 'What is Apple\'s latest stock price? Summarize the latest news about Apple too, and cite the sources for each claim.';

assert.ok(process.env.ANTHROPIC_API_KEY, 'Set ANTHROPIC_API_KEY. No fixture fallback — this acceptance must run a real model.');
mkdirSync(join(output, 'kernel'), { recursive: true });
mkdirSync(join(output, 'pi-sessions'), { recursive: true });

// Fixture-replay shim for the Longbridge CLI transport (declared stub scope).
rmSync(shimDir, { recursive: true, force: true });
mkdirSync(shimDir, { recursive: true });
execSync(`bun build --compile ${join(here, 'apps/electron/e2e/longbridge-shim.ts')} --outfile ${join(shimDir, 'longbridge.exe')}`, { stdio: 'pipe' });
process.env.PATH = `${shimDir}${delimiter}${process.env.PATH ?? ''}`;

const kernel = new AgentKernel({
  provider: 'pi-runtime',
  storageDir: join(output, 'kernel'),
  piSessionDir: join(output, 'pi-sessions'),
  rpc: {
    cwd: here,
    extensions: [],
    env: () => process.env,
    requestTimeoutMs: 240_000,
  },
});

const events: AgentEvent[] = [];
kernel.runs.subscribe((event) => events.push(event));

const session = await kernel.sessions.createSession('Copilot citation acceptance');
await kernel.runs.startRun(session.id, question);
const deadline = Date.now() + 360_000;
let completed: { answer: string; toolCalls: ToolCall[] } | undefined;
while (Date.now() < deadline) {
  await Bun.sleep(1_000);
  const finished = events.find((event) => event.type === 'run_completed') as
    | { payload: { answer: string; toolCalls: ToolCall[] } }
    | undefined;
  const failed = events.find((event) => event.type === 'run_failed') as
    | { payload: { error: { message: string } } }
    | undefined;
  if (finished) { completed = finished.payload; break; }
  if (failed) throw new Error(`Copilot run failed: ${failed.payload.error.message}`);
}
assert.ok(completed, 'Copilot run did not finish in time');
await kernel.dispose();

const { answer, toolCalls } = completed;
await writeArtifacts('answer.json', { question, answer });
await writeArtifacts('tool-calls.json', toolCalls);

// ── Assertions ───────────────────────────────────────────────────────────────
// 1. The answer carries inline citation markers.
assert.ok(answer.includes(CITATION_MARKER_START), 'Answer contains no inline citation markers');
const citedIds = parseCitationSegments(answer)
  .filter((part) => part.kind === 'citation')
  .map((part) => (part as { sourceId: string }).sourceId);
assert.ok(citedIds.length > 0, 'No citation ids parsed from the answer');

// 2. Every cited id is a real tool call from this run — never fabricated.
const toolCallIds = new Set(toolCalls.map((call) => call.id));
const fabricated = [...new Set(citedIds)].filter((id) => !toolCallIds.has(id));
assert.equal(fabricated.length, 0, `Citations reference unknown tool calls: ${fabricated.join(', ')}`);

// 3. Mixed sources: at least two distinct tools cited, quote + news included.
const toolNameById = new Map(toolCalls.map((call) => [call.id, call.toolName]));
const citedTools = [...new Set(citedIds.map((id) => toolNameById.get(id)))].filter(Boolean) as string[];
assert.ok(citedTools.length >= 2, `Expected citations from >=2 tools, got: ${citedTools.join(', ')}`);
assert.ok(citedTools.some((name) => name === 'get_quote'), 'No structured financial citation (get_quote)');
assert.ok(citedTools.some((name) => /news/i.test(name)), 'No news (web) citation');

// 4. Citations resolve to real evidence envelopes (the persisted record join).
const successfulCalls = toolCalls.filter((call) => call.status === 'success');
const envelopes = buildFinancialEvidence({ sessionId: session.id, runId: 'copilot-acceptance', toolCalls: successfulCalls as never });
const envelopeByToolCallId = new Map(envelopes.map((envelope) => [envelope.toolCallId, envelope]));
const resolution = [...new Set(citedIds)].map((id) => {
  const envelope = envelopeByToolCallId.get(id);
  return {
    citationId: id,
    toolName: toolNameById.get(id),
    resolved: Boolean(envelope),
    envelopeId: envelope?.id,
    provider: envelope?.provider,
    kind: envelope?.kind,
    values: envelope?.values.slice(0, 3).map((value) => `${value.metric}=${value.normalizedValue}`),
  };
});
await writeArtifacts('citation-resolution.json', resolution);
assert.ok(resolution.some((entry) => entry.resolved && entry.kind === 'quote'), 'Financial citation did not resolve to an evidence envelope');

const verification = {
  mode: 'live AgentKernel(Pi runtime) + real model; Pi-extension tool chain; longbridge transport replaced by fixture-replay shim',
  question,
  answer,
  citedIds: [...new Set(citedIds)],
  citedTools,
  toolCallCount: toolCalls.length,
  resolution,
  markerCount: citedIds.length,
};
await writeArtifacts('verification.json', verification);
console.log(JSON.stringify({ citedTools, citedIds: [...new Set(citedIds)], markerCount: citedIds.length, artifacts: output }, null, 2));
console.log('\nCopilot citation acceptance PASSED.');
process.exit(0);

async function writeArtifacts(name: string, value: unknown): Promise<void> {
  writeFileSync(join(output, name), JSON.stringify(value, null, 2), 'utf8');
}
