// Typed financial answer blocks (#31) — real-app Copilot E2E.
//
// Runs the packaged-path Electron app with the deterministic local provider
// and FINAGENT_DEMO_DATA=1 (offline sample data, labeled 'demo'), then drives
// the Copilot through quote / portfolio / portfolio-risk asks and asserts the
// typed blocks render: metric_grid + time_series_chart, data_table, and
// comparison_table, each with its DemoBadge and evidence hooks. Screenshots
// land in e2e/artifacts/ for the PR demo.
//
// Hidden by default; run via `bun run test:typed-blocks` (or
// FINAGENT_E2E_VISIBLE=1 bun run test:typed-blocks).
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..');
const repoRoot = join(here, '../../..');
const electronMain = join(appRoot, 'src/main/index.js');
const artifactsDir = join(here, 'artifacts');
const CDP_PORT = 9377;
const CDP_URL = `http://127.0.0.1:${CDP_PORT}`;
const userDataDir = join(appRoot, 'e2e/.user-data-typed-blocks');

let failures = 0;
const pass = (name) => console.log(`PASS  ${name}`);
const fail = (name, error) => {
  failures += 1;
  console.error(`FAIL  ${name}`);
  console.error(String(error?.stack ?? error).slice(0, 900));
};

function resolveElectronBinary() {
  const candidates = [
    process.env.ELECTRON_BINARY,
    (() => {
      try {
        return require(join(appRoot, 'node_modules/electron'));
      } catch {
        return null;
      }
    })(),
    join(repoRoot, 'node_modules/electron/dist/electron.exe'),
    join(repoRoot, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
  ].filter(Boolean);
  const binary = candidates.find((candidate) => existsSync(candidate));
  if (!binary) throw new Error(`Electron binary not found. Checked: ${candidates.join(', ')}`);
  return binary;
}

function launch() {
  const proc = spawn(
    resolveElectronBinary(),
    [electronMain, `--remote-debugging-port=${CDP_PORT}`, '--no-sandbox'],
    {
      cwd: repoRoot,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: {
        ...process.env,
        FINAGENT_AGENT_PROVIDER: 'local',
        FINAGENT_DEMO_DATA: '1',
        FINAGENT_FORCE_PROD_LOAD: '1',
        FINAGENT_E2E: '1',
        FINAGENT_E2E_HIDDEN: process.env.FINAGENT_E2E_VISIBLE === '1' ? undefined : '1',
        FINAGENT_USER_DATA_DIR: userDataDir,
      },
    }
  );
  return proc;
}

async function waitForCdp(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${CDP_URL}/json/version`);
      if (response.ok) return;
    } catch {
      // still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('CDP timeout');
}

async function waitForPage(context, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pages = context.pages();
    if (pages.length > 0) return pages[pages.length - 1];
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('no page');
}

async function askAndWait(page, text, selector, timeoutMs = 45_000) {
  await page.locator('[data-testid="agent-input"]').first().fill(text);
  await page.locator('[data-testid="agent-input"]').first().press('Enter');
  await page.locator(selector).first().waitFor({ timeout: timeoutMs });
}

/** Center a rendered block in the Copilot panel body, then let layout settle. */
async function centerBlockInPanel(page, selector) {
  await page.evaluate((sel) => {
    document.querySelector(sel)?.scrollIntoView({ block: 'center' });
  }, selector);
  await page.waitForTimeout(400);
}

/**
 * Capture the current frame via CDP. Playwright's page.screenshot waits for
 * render quiescence, which a hidden (FINAGENT_E2E_HIDDEN=1) Electron window
 * throttles; Page.captureScreenshot just grabs the last presented frame.
 */
async function screenshotPage(page, path, timeoutMs = 10_000) {
  // A visible window presents frames normally, so prefer Playwright's
  // screenshot; a hidden (FINAGENT_E2E_HIDDEN=1) window throttles frames, so
  // grab the raw renderer surface via CDP and never block the run on it.
  if (process.env.FINAGENT_E2E_VISIBLE === '1') {
    await page.screenshot({ path, animations: 'disabled' });
    return;
  }
  const capture = (async () => {
    const cdp = await page.context().newCDPSession(page);
    try {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: false });
      writeFileSync(path, Buffer.from(data, 'base64'));
    } finally {
      await cdp.detach().catch(() => {});
    }
  })();
  const timeout = new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs));
  const ok = await Promise.race([capture.then(() => true), timeout]);
  if (!ok) console.warn(`WARN  screenshot skipped (timeout): ${path}`);
}

async function main() {
  try {
    execSync(`pkill -f 'remote-debugging-port=${CDP_PORT}' || true`, { stdio: 'ignore' });
  } catch {}
  execSync('bun run build:preload', { cwd: appRoot, stdio: 'pipe' });
  execSync('bun x vite build', { cwd: appRoot, stdio: 'pipe' });
  execSync('bun run build:main', { cwd: appRoot, stdio: 'pipe' });
  rmSync(userDataDir, { recursive: true, force: true });
  mkdirSync(userDataDir, { recursive: true });
  mkdirSync(artifactsDir, { recursive: true });
  const { seedLocale } = await import('./seed-locale.mjs');
  seedLocale(userDataDir, 'en-US');

  let proc = launch();
  try {
    await waitForCdp(120_000);
    const browser = await chromium.connectOverCDP(CDP_URL, { timeout: 30_000 });
    const context = browser.contexts()[0];
    const page = await waitForPage(context, 30_000);
    await page.waitForLoadState('domcontentloaded');
    await page.locator('[data-testid="finance-workspace"]').waitFor({ timeout: 30_000 });

    // Fresh user data shows the onboarding wizard; complete it like a user.
    const onboarding = page.locator('[data-testid="onboarding-overlay"]');
    try {
      await onboarding.waitFor({ timeout: 8_000 });
      await page.locator('[data-testid="disclaimer-accept"]').click();
      await page.locator('[data-testid="onboarding-continue"]').click();
      await page.locator('[data-testid="onboarding-skip"]').click();
      await onboarding.waitFor({ state: 'detached', timeout: 15_000 });
    } catch {
      // Onboarding already completed (persisted user data).
    }

    await page.getByRole('button', { name: 'New Session', exact: true }).waitFor({ timeout: 15_000 });
    await page.getByRole('button', { name: 'New Session', exact: true }).click();
    await page.locator('[data-testid="agent-input"]').first().waitFor({ timeout: 15_000 });

    const panel = page.locator('[data-testid="agent-panel"]').first();

    // 1. Quote → metric_grid (KPI) + time_series_chart, labeled sample data.
    try {
      await askAndWait(page, 'What is the quote for AAPL.US?', '[data-block-type="metric_grid"]');
      await page
        .locator('[data-testid="agent-panel"] [data-block-type="time_series_chart"]')
        .first()
        .waitFor({ timeout: 30_000 });
      const badgeCount = await panel.locator('[data-testid="demo-badge"]').count();
      if (badgeCount === 0) throw new Error('demo badge missing on sample-data blocks');
      const evidenceCount = await panel.locator('[data-evidence-id]').count();
      if (evidenceCount === 0) throw new Error('evidence hooks missing');
      await centerBlockInPanel(page, '[data-block-type="metric_grid"]');
      await screenshotPage(page, join(artifactsDir, 'typed-blocks-quote.png'));
      pass('1: quote answer renders metric_grid + time_series_chart with demo badge + evidence');
    } catch (error) {
      fail('1: quote typed blocks', error);
    }

    // 2. Portfolio → data_table.
    try {
      await askAndWait(page, 'Show my portfolio', '[data-block-type="data_table"]');
      await centerBlockInPanel(page, '[data-block-type="data_table"]');
      await screenshotPage(page, join(artifactsDir, 'typed-blocks-portfolio.png'));
      pass('2: portfolio answer renders data_table');
    } catch (error) {
      fail('2: portfolio data_table', error);
    }

    // 3. Portfolio risk → comparison_table.
    try {
      await askAndWait(page, 'What is my portfolio risk?', '[data-block-type="comparison_table"]');
      await centerBlockInPanel(page, '[data-block-type="comparison_table"]');
      await screenshotPage(page, join(artifactsDir, 'typed-blocks-risk.png'));
      pass('3: risk answer renders comparison_table');
    } catch (error) {
      fail('3: risk comparison_table', error);
    }

    // 4. Reload persistence: the most recent session auto-restores, so the
    // persisted blocks must rebuild from message content alone.
    try {
      await page.evaluate(() => window.electronAPI?.window?.close?.() ?? window.close()).catch(() => {});
      await page.close().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 2500));
      proc.kill();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      proc = launch();
      await waitForCdp(120_000);
      const browser2 = await chromium.connectOverCDP(CDP_URL, { timeout: 30_000 });
      const page2 = await waitForPage(browser2.contexts()[0], 30_000);
      await page2.waitForLoadState('domcontentloaded');
      await page2.locator('[data-testid="finance-workspace"]').waitFor({ timeout: 30_000 });
      const onboarding2 = page2.locator('[data-testid="onboarding-overlay"]');
      try {
        await onboarding2.waitFor({ timeout: 8_000 });
        await page2.locator('[data-testid="disclaimer-accept"]').click();
        await page2.locator('[data-testid="onboarding-continue"]').click();
        await page2.locator('[data-testid="onboarding-skip"]').click();
        await onboarding2.waitFor({ state: 'detached', timeout: 15_000 });
      } catch {
        // already completed
      }
      await page2
        .locator('[data-testid="agent-panel"] [data-block-type="metric_grid"]')
        .first()
        .waitFor({ timeout: 30_000 });
      pass('4: typed blocks rebuild from persisted messages after reload');
    } catch (error) {
      fail('4: reload persistence', error);
    }
  } catch (error) {
    fail('boot', error);
  } finally {
    try {
      proc?.kill();
    } catch {}
  }

  if (failures > 0) {
    console.error(`\n${failures} typed-blocks E2E check(s) failed`);
    process.exit(1);
  }
  console.log('\nAll typed-blocks E2E checks passed');
}

await main();
