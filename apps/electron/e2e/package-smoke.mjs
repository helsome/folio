// Folio packaged-app smoke test — launches the electron-builder output from
// OUTSIDE the source repo and asserts the packaged app is self-contained:
// window renders, skills load from process.resourcesPath, agent tools are
// present, and a local agent run completes.
//
//   bun run test:package-smoke
//
// Prerequisite: `bun run package` must have produced dist/electron/mac*/Folio.app.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..');
const repoRoot = join(here, '../../..');
const distDir = join(repoRoot, 'dist', 'electron');

const CDP_PORT = 9334;
const CDP_URL = `http://127.0.0.1:${CDP_PORT}`;

let failures = 0;

function pass(name) {
  console.log(`PASS  ${name}`);
}

function fail(name, error) {
  failures += 1;
  console.error(`FAIL  ${name}`);
  console.error(String(error?.stack ?? error).slice(0, 2000));
}

function findAppBinary() {
  if (!existsSync(distDir)) {
    throw new Error(`No dist output at ${distDir}. Run \`bun run package\` first.`);
  }
  for (const entry of readdirSync(distDir)) {
    if (!entry.startsWith('mac')) continue;
    const candidate = join(distDir, entry, 'Folio.app', 'Contents', 'MacOS', 'Folio');
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }
  throw new Error(`No Folio.app binary found under ${distDir}/mac*.`);
}

async function waitForCdp(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${CDP_URL}/json/version`);
      if (response.ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Packaged app CDP endpoint did not come up in time.');
}

function evaluateIpC(page, expr) {
  return page.evaluate(`(async () => (${expr}))()`);
}

async function main() {
  const appBinary = findAppBinary();
  console.log(`Launching ${appBinary}`);
  const userDataDir = mkdtempSync(join(tmpdir(), 'folio-smoke-'));

  const appProcess = spawn(appBinary, [`--remote-debugging-port=${CDP_PORT}`, '--no-sandbox'], {
    cwd: tmpdir(),
    stdio: 'ignore',
    env: {
      ...process.env,
      FINAGENT_AGENT_PROVIDER: 'local',
      FINAGENT_USER_DATA_DIR: userDataDir,
    },
  });

  let browser;
  try {
    await waitForCdp(60_000);
    browser = await chromium.connectOverCDP(CDP_URL, { timeout: 30_000 });
    const context = browser.contexts()[0];
    await context.waitForEvent('page', { timeout: 30_000 }).catch(() => undefined);
    const pages = context.pages();
    const page = pages[pages.length - 1];
    await page.waitForLoadState('domcontentloaded');

    // A. Window renders + preload bridge is present.
    try {
      await page.locator('[data-testid="finance-workspace"]').waitFor({ timeout: 20_000 });
      const hasBridge = await page.evaluate(() => Boolean(window.electronAPI));
      if (!hasBridge) throw new Error('window.electronAPI is not exposed (preload failed).');
      pass('A: workbench renders + preload bridge present');
    } catch (error) {
      fail('A: workbench renders + preload bridge present', error);
    }

    // B. Skills load from the packaged resources.
    try {
      const result = await evaluateIpC(page, 'window.electronAPI.skills.list()');
      if (!result?.ok) throw new Error(`skills:list failed: ${JSON.stringify(result)}`);
      const skills = result.data;
      if (!Array.isArray(skills) || skills.length < 10) {
        throw new Error(`expected >=10 skills, got ${skills?.length}`);
      }
      console.log(`  skills loaded: ${skills.length}`);
      pass('B: skills:list returns >=10 skills');
    } catch (error) {
      fail('B: skills:list returns >=10 skills', error);
    }

    // C. Agent tools include finance tools.
    try {
      const result = await evaluateIpC(page, 'window.electronAPI.agent.getTools()');
      if (!result?.ok) throw new Error(`agent:getTools failed: ${JSON.stringify(result)}`);
      const inner = result.data;
      const tools = Array.isArray(inner) ? inner : inner?.data;
      if (!Array.isArray(tools)) throw new Error(`agent:getTools returned no tools: ${JSON.stringify(result)}`);
      const names = new Set(tools.map((tool) => tool.name));
      for (const expected of ['get_quote', 'get_portfolio']) {
        if (!names.has(expected)) {
          throw new Error(`finance tool missing: ${expected}; have [${[...names].join(', ')}]`);
        }
      }
      console.log(`  tools: ${names.size} (${[...names].slice(0, 8).join(', ')}${names.size > 8 ? ', …' : ''})`);
      pass('C: agent:getTools includes finance tools');
    } catch (error) {
      fail('C: agent:getTools includes finance tools', error);
    }

    // D. Create a session and run a local agent run to completion.
    try {
      const created = await evaluateIpC(page, 'window.electronAPI.kernel.createSession("Smoke")');
      if (!created?.ok) throw new Error(`sessions:create failed: ${JSON.stringify(created)}`);
      const sessionId = created.data?.id;
      if (!sessionId) throw new Error(`sessions:create returned no id: ${JSON.stringify(created)}`);

      const started = await evaluateIpC(
        page,
        `window.electronAPI.kernel.startRun({ sessionId: ${JSON.stringify(sessionId)}, content: 'Hello, are you there?' })`
      );
      if (!started?.ok) throw new Error(`runs:start failed: ${JSON.stringify(started)}`);
      const runId = started.data?.id;
      if (!runId) throw new Error(`runs:start returned no run id: ${JSON.stringify(started)}`);

      // Poll listRuns until the run settles (completed/failed/cancelled).
      const deadline = Date.now() + 30_000;
      let run = null;
      while (Date.now() < deadline) {
        const runs = await evaluateIpC(
          page,
          `window.electronAPI.kernel.listRuns(${JSON.stringify(sessionId)})`
        );
        const candidate = runs?.ok && Array.isArray(runs.data) ? runs.data.find((r) => r.id === runId) : undefined;
        if (candidate && candidate.status !== 'running') {
          run = candidate;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (!run) throw new Error('run did not settle within 30s');
      if (run.status !== 'completed') {
        throw new Error(`run settled as ${run.status}: ${JSON.stringify(run.error ?? run.answer ?? '')}`);
      }
      console.log(`  run ${run.id} completed: "${String(run.answer).slice(0, 80)}"`);
      pass('D: sessions:create + local run completes');
    } catch (error) {
      fail('D: sessions:create + local run completes', error);
    }
  } catch (error) {
    fail('harness setup', error);
  } finally {
    await browser?.close().catch(() => undefined);
    appProcess.kill();
  }

  if (failures > 0) {
    console.error(`Package smoke failed: ${failures} step(s).`);
    process.exit(1);
  }
  console.log('Packaged app smoke passed.');
}

main();
