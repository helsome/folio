// V5 golden-path additions (spec §88, §93): Discover → candidates, Portfolio
// Import paste flow, automation rules/brief, outcome evaluation — all against
// the hidden Electron app with real IPC + real Longbridge data where available.
//
//   FINAGENT_AGENT_PROVIDER=local node e2e/v5.mjs

import { execSync, spawn } from 'node:child_process';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..');
const repoRoot = join(here, '../../..');
const electronMain = join(appRoot, 'src/main/index.ts');
const electronBinary = join(
  repoRoot,
  'node_modules/.bun/electron@39.8.9/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
);
const CDP_PORT = 9349;

let failures = 0;
function pass(name) {
  console.log(`PASS  ${name}`);
}
function fail(name, error) {
  failures += 1;
  console.error(`FAIL  ${name}`);
  console.error(String(error?.stack ?? error).slice(0, 1600));
}

async function waitForCdp(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (response.ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Electron CDP endpoint did not come up in time.');
}

async function waitForPage(context, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pages = context.pages();
    if (pages.length > 0) return pages[pages.length - 1];
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('No renderer page appeared in time');
}

async function main() {
  if (!existsSync(electronBinary)) {
    console.error(`Electron binary not found: ${electronBinary}`);
    process.exit(1);
  }
  try {
    execSync(`pkill -f 'remote-debugging-port=${CDP_PORT}' || true`, { stdio: 'ignore' });
  } catch {
    // Nothing to clean.
  }
  execSync('bun run build:preload', { cwd: appRoot, stdio: 'pipe' });
  execSync('bunx vite build', { cwd: appRoot, stdio: 'pipe' });

  const userDataDir = join(appRoot, 'e2e/.user-data-v5');
  rmSync(userDataDir, { recursive: true, force: true });
  mkdirSync(userDataDir, { recursive: true });

  const electronProcess = spawn(
    electronBinary,
    [electronMain, `--remote-debugging-port=${CDP_PORT}`, '--no-sandbox'],
    {
      cwd: repoRoot,
      stdio: 'ignore',
      env: {
        ...process.env,
        FINAGENT_AGENT_PROVIDER: 'local',
        FINAGENT_FORCE_PROD_LOAD: '1',
        FINAGENT_E2E: '1',
        FINAGENT_E2E_HIDDEN: '1',
        FINAGENT_USER_DATA_DIR: userDataDir,
      },
    }
  );

  let browser;
  try {
    await waitForCdp(60_000);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`, { timeout: 30_000 });
    const context = browser.contexts()[0];
    const page = await waitForPage(context, 30_000);
    await page.waitForLoadState('domcontentloaded');

    // V1. Discover renders and a screening task produces candidates or an
    // honest failure (rate limits are real on the free CLI).
    try {
      await page.getByRole('button', { name: /^Discover$/i }).first().click();
      await page.locator('[data-testid="discover-view"]').waitFor({ timeout: 15_000 });
      await page.locator('[data-testid="discover-run-strong-momentum"]').first().click();
      await page
        .locator('[data-testid="discover-results"], [data-testid="discover-failures"]')
        .first()
        .waitFor({ timeout: 60_000 });
      pass('V1: Discover renders and screening runs (results or honest failures)');
    } catch (error) {
      fail('V1: Discover renders and screening runs (results or honest failures)', error);
    }

    // V2. Portfolio Import paste flow: draft → confirm → manual portfolio.
    try {
      await page.getByRole('button', { name: /^Portfolio$/i }).first().click();
      await page.getByRole('button', { name: /Import/i }).first().click();
      await page.getByRole('button', { name: 'Paste holdings' }).click();
      const textarea = page.locator('textarea');
      await textarea.first().fill('NVDA 100 120.3\nAAPL.US, 50, 180.2');
      await page.getByRole('button', { name: /Review|Parse/i }).first().click();
      await page.getByText('Confirm Import', { exact: true }).waitFor({ timeout: 15_000 });
      const manualRows = await page.getByText('NVDA', { exact: false }).count();
      if (manualRows < 1) throw new Error('Draft rows missing');
      await page.getByRole('button', { name: 'Confirm Import' }).click();
      await page.getByText('Importing…', { exact: true }).waitFor({ timeout: 5_000 }).catch(() => undefined);
      await page.waitForTimeout(1500);
      pass('V2: paste import produces a draft and confirms');
    } catch (error) {
      fail('V2: paste import produces a draft and confirms', error);
    }

    // V3. Automation: five seeded rules + a brief builds + manual run works.
    try {
      const rules = await page.evaluate(() => window.electronAPI.automation.listRules());
      if (!rules?.ok || !Array.isArray(rules.data) || rules.data.length < 5) {
        throw new Error(`expected >=5 seeded rules, got ${JSON.stringify(rules).slice(0, 200)}`);
      }
      const brief = await page.evaluate(() => window.electronAPI.automation.buildBrief());
      if (!brief?.ok || typeof brief.data?.summary !== 'string') {
        throw new Error(`buildBrief failed: ${JSON.stringify(brief).slice(0, 200)}`);
      }
      const run = await page.evaluate(() =>
        window.electronAPI.automation.runRule({ ruleId: 'watchlist-daily-review' })
      );
      if (!run?.ok || typeof run.data?.id !== 'string') {
        throw new Error(`runRule failed: ${JSON.stringify(run).slice(0, 200)}`);
      }
      pass('V3: automation rules seeded, brief builds, manual run records');
    } catch (error) {
      fail('V3: automation rules seeded, brief builds, manual run records', error);
    }

    // V4. Outcome evaluation runs without crashing (no opinions yet → empty).
    try {
      const result = await page.evaluate(() => window.electronAPI.outcome.evaluateDue());
      if (!result?.ok || !Array.isArray(result.data)) {
        throw new Error(`evaluateDue failed: ${JSON.stringify(result).slice(0, 200)}`);
      }
      pass('V4: outcome evaluation pipeline responds');
    } catch (error) {
      fail('V4: outcome evaluation pipeline responds', error);
    }

    // V5. Today renders with Market Pulse + Daily Brief sections.
    try {
      await page.getByRole('button', { name: /^Today$/i }).first().click();
      await page.locator('[data-testid="today-view"]').waitFor({ timeout: 15_000 });
      await page.locator('[data-testid="brief-items"], [data-testid="brief-quiet"]').first().waitFor({ timeout: 15_000 });
      pass('V5: Today shows Daily Brief');
    } catch (error) {
      fail('V5: Today shows Daily Brief', error);
    }

    await browser.close();
  } catch (error) {
    fail('harness setup', error);
  } finally {
    if (process.env.FINAGENT_E2E_KEEP_OPEN === '1') {
      console.log(`KEEP_OPEN CDP port ${CDP_PORT}`);
    } else {
      electronProcess.kill();
    }
  }

  if (failures > 0) {
    console.error(`V5 E2E failed: ${failures} failure(s).`);
    process.exit(1);
  }
  console.log('V5 E2E passed.');
}

void main();
