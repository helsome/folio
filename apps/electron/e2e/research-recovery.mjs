// Real Electron fault injection. Never substitutes local synthesis or fake retrieval.
// Configure an isolated FINAGENT_RECOVERY_USER_DATA profile, then run this file with Node.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { chromium } from 'playwright-core';
import { reserveCdpPort, resolveElectronBinary, waitForCdp } from './electron-harness.mjs';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(appRoot, '../..');
const userData = process.env.FINAGENT_RECOVERY_USER_DATA;
if (!userData) throw new Error('Configure a separate live profile and set FINAGENT_RECOVERY_USER_DATA. No fixtures are accepted.');
const symbol = process.env.FINAGENT_RECOVERY_SYMBOL ?? 'NVDA.US';
const output = resolve(process.env.FINAGENT_RECOVERY_OUTPUT ?? join(appRoot, 'e2e/artifacts/research-recovery'));
await mkdir(output, { recursive: true });
let processHandle;
let browser;
let page;
async function launch() {
  const port = await reserveCdpPort();
  const logPath = join(output, 'electron.log');
  const log = openSync(logPath, 'a');
  try {
    processHandle = spawn(resolveElectronBinary(appRoot, repoRoot), [
      join(appRoot, 'src/main/index.js'), '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=' + port, '--disable-gpu',
    ], {
      cwd: repoRoot, windowsHide: true, stdio: ['ignore', log, log],
      env: { ...process.env, FINAGENT_AGENT_PROVIDER: 'pi-runtime', FINAGENT_FORCE_PROD_LOAD: '1',
        FINAGENT_USER_DATA_DIR: userData, FINAGENT_E2E_HIDDEN: '1' },
    });
  } finally { closeSync(log); }
  await waitForCdp({ url: 'http://127.0.0.1:' + port, timeoutMs: 30000, proc: processHandle, logPath });
  browser = await chromium.connectOverCDP('http://127.0.0.1:' + port);
  page = browser.contexts()[0].pages()[0] ?? await browser.contexts()[0].waitForEvent('page');
  await page.waitForFunction(() => Boolean(window.electronAPI?.research));
}
async function call(method, input) {
  const result = await page.evaluate(async ([method, input]) => window.electronAPI.research[method](input), [method, input]);
  assert.equal(result.ok, true, JSON.stringify(result.error));
  return result.data;
}
async function checkpoint(id) {
  const file = join(userData, 'store/research/checkpoints', id + '.json');
  const envelope = JSON.parse(await readFile(file, 'utf8'));
  return { envelope, cp: JSON.parse(envelope.payload) };
}
async function poll(read, predicate, timeout = 300000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error('Timed out waiting for a real research checkpoint');
}
async function stop() {
  if (processHandle && processHandle.exitCode === null && processHandle.signalCode === null) {
    const exit = once(processHandle, 'exit');
    processHandle.kill('SIGKILL');
    await exit;
  }
  await browser?.close().catch(() => {});
}

try {
  await launch();
  const state = await page.evaluate(() => window.electronAPI.llm.getState());
  assert.equal(state.ok, true, 'Configure a real model in this profile before running.');
  assert.ok(state.data.model?.id, 'No real model configured.');
  assert.notEqual(state.data.runtimeProvider, 'local');
  const started = await call('start', { symbol });
  await page.reload();
  await page.waitForFunction(() => Boolean(window.electronAPI?.research));
  assert.equal((await call('getRun', { runId: started.id })).id, started.id);
  await page.evaluate(() => {
    window.__recoveryModelEvents = [];
    window.electronAPI.kernel.onAgentEvent((event) => {
      if (event.type === 'message_delta') window.__recoveryModelEvents.push(event.runId);
    });
  });
  const before = await poll(async () => {
    const saved = await checkpoint(started.id);
    return { ...saved, modelEvents: await page.evaluate(() => window.__recoveryModelEvents) };
  }, ({ cp, modelEvents }) => cp.phase === 'synthesizing' && !cp.synthesis &&
    cp.events.some((event) => event.agentRunId && modelEvents.includes(event.agentRunId)) &&
    cp.outcomes.some((o) => o.record.capabilityId === 'research.news' && o.record.status === 'success' &&
      o.result?.provenance.provider && !['test', 'local', 'fixture'].includes(o.result.provenance.provider)));
  const killedPid = processHandle.pid;
  await stop();
  await writeFile(join(output, 'before-checkpoint.json'), JSON.stringify(before.envelope, null, 2));
  await launch();
  const interrupted = await call('getRun', { runId: started.id });
  assert.equal(interrupted.status, 'interrupted');
  assert.equal(interrupted.recoverable, true);
  await page.evaluate(() => {
    localStorage.setItem('folio.onboarding.completed.v1', '1');
    localStorage.setItem('folio.onboarding.disclaimersAccepted.v1', '1');
    localStorage.setItem('folio.prefs.navSection', JSON.stringify('research'));
  });
  await page.reload();
  await page.getByTestId('research-recovery').first().waitFor();
  await page.screenshot({ path: join(output, 'interrupted.png'), fullPage: true });
  const recoveryCard = page.getByTestId('research-recovery').filter({ hasText: symbol }).first();
  await recoveryCard.getByRole('button', { name: /^(Resume|继续研究)$/ }).click();
  const terminal = await poll(() => call('getRun', { runId: started.id }),
    (run) => run.recoveryCount === (interrupted.recoveryCount ?? 0) + 1 &&
      ['completed', 'partial', 'failed', 'cancelled', 'interrupted'].includes(run.status));
  assert.ok(['completed', 'partial'].includes(terminal.status), JSON.stringify(terminal));
  const after = await checkpoint(started.id);
  const report = await call('getReport', { reportId: terminal.reportId });
  for (const outcome of before.cp.outcomes) {
    assert.deepEqual(after.cp.outcomes.find((o) => o.record.capabilityId === outcome.record.capabilityId), outcome);
  }
  assert.deepEqual(after.cp.retry.attempts, before.cp.retry.attempts);
  assert.equal(new Set(report.sections.map((s) => s.key)).size, report.sections.length);
  const evidence = report.sections.flatMap((s) => s.evidence);
  assert.equal(new Set(evidence.map((e) => e.capabilityId + ':' + e.runId)).size, evidence.length);
  await call('resume', { runId: started.id });
  assert.equal((await call('listReports', { symbol })).filter((r) => r.id === report.id).length, 1);
  await writeFile(join(output, 'after-checkpoint.json'), JSON.stringify(after.envelope, null, 2));
  await writeFile(join(output, 'final-report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(output, 'verification.json'), JSON.stringify({
    mode: 'live', symbol, killedPid, killPoint: 'model streaming after durable retrieval, before synthesis checkpoint',
    beforeRunId: before.cp.summary.id, afterRunId: after.cp.summary.id,
    checkpointVersion: after.cp.version, recoveryCount: after.cp.summary.recoveryCount,
    evidenceCount: evidence.length, noDuplicateEvidence: true, noRepeatedCompletedSteps: true,
    reportId: report.id, status: terminal.status,
  }, null, 2));
  await page.screenshot({ path: join(output, 'completed.png'), fullPage: true });
  console.log('PASS live research crash recovery: ' + started.id);
} finally { await stop(); }
