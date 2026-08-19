// Folio V9 UX audit capture — exercises the app as a real first-time user and
// captures every major state for visual review. Hidden by default.
import { execSync, spawn } from 'node:child_process';
import { seedLocale } from './seed-locale.mjs';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
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
const cdpPort = 9361;
const cdpUrl = `http://127.0.0.1:${cdpPort}`;
const userDataDir = join(appRoot, 'e2e/.user-data-uxaudit');
const outDir = process.env.UX_AUDIT_OUT || join(appRoot, 'e2e/artifacts/v9-audit');

async function waitForCdp(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${cdpUrl}/json/version`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('CDP timeout');
}

async function waitForPage(context, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pages = context.pages();
    if (pages.length > 0) return pages[pages.length - 1];
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('No renderer page');
}

async function main() {
  if (!existsSync(electronBinary)) throw new Error('Electron binary not found');
  try { execSync(`pkill -f 'remote-debugging-port=${cdpPort}' || true`, { stdio: 'ignore' }); } catch {}
  execSync('bun run build:preload', { cwd: appRoot, stdio: 'pipe' });
  execSync('bunx vite build', { cwd: appRoot, stdio: 'pipe' });
  rmSync(userDataDir, { recursive: true, force: true });
  mkdirSync(userDataDir, { recursive: true });
  seedLocale(userDataDir, 'en-US');
  mkdirSync(outDir, { recursive: true });

  const proc = spawn(
    electronBinary,
    [electronMain, `--remote-debugging-port=${cdpPort}`, '--no-sandbox'],
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
    browser = await chromium.connectOverCDP(cdpUrl, { timeout: 30_000 });
    const page = await waitForPage(browser.contexts()[0], 30_000);
    await page.waitForLoadState('domcontentloaded');

    async function capture(name, width = 1440, height = 900, settle = 900) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(settle);
      const path = join(outDir, `${name}.png`);
      await page.screenshot({ path, animations: 'disabled' });
      console.log(`CAPTURE ${name} (${width}x${height}) → ${path}`);
    }

    // Wait for the initial UI (session bootstrap may auto-create).
    await page.locator('[data-testid="finance-workspace"]').waitFor({ timeout: 30_000 });
    // The app boots into the workspace (sessions/watchlist). Navigate to Today.
    const diag = await page.evaluate(() => ({
      overlay: !!document.querySelector('[data-testid="onboarding-overlay"]'),
      bodyText: (document.body?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 300),
      aria: [...document.querySelectorAll('button')].map((b) => b.getAttribute('aria-label')).filter(Boolean).slice(0, 20),
    }));
    console.log('BOOT DIAG:', JSON.stringify(diag, null, 2));
    const todayBtn = page.locator('[aria-label="今日"], [aria-label="Today"]').first();
    await todayBtn.click({ timeout: 10_000 });
    await page.locator('[data-testid="today-view"]').waitFor({ timeout: 30_000 });
    await page.waitForTimeout(2500);
    await capture('01-today-first-user', 1440, 900);

    // Agent panel empty state (copilot before a session)


    // Discover browse
    await page.locator('[aria-label="机会发现"], [aria-label="Discover"]').first().click();
    await page.locator('[data-testid="discover-view"]').waitFor({ timeout: 15_000 });
    await page.waitForTimeout(1200);
    await capture('02-discover-browse', 1440, 900);

    // Run the first screener task (Growth)
    const firstTask = page.locator('[data-testid^="discover-run-"]').first();
    const taskCount = await firstTask.count().catch(() => 0);
    console.log('TASKS:', taskCount);
    if (taskCount > 0) {
      await firstTask.click();
      await page.waitForTimeout(1200);
      await capture('03-discover-running', 1440, 900, 600);
      // Wait for results (longbridge CLI may be slow / unavailable)
      try {
        await page.locator('[data-testid="discover-results"]').waitFor({ timeout: 120_000 });
        await page.waitForTimeout(1500);
        await capture('04-discover-results', 1440, 900);
      } catch {
        console.log('DISCOVER RESULTS TIMEOUT — dumping state');
        await capture('04b-discover-no-results', 1440, 900);
      }
    }

    // Research start (from a symbol in the watchlist) — go to the workspace first
    await page.locator('[aria-label="工作台"], [aria-label="Workspace"]').first().click();
    await page.locator('[data-testid="watchlist-row-NVDA.US"]').first().click();
    await page.locator('[aria-label="研究"], [aria-label="Research"]').first().click();
    await page.locator('[data-testid="research-panel"]').waitFor({ timeout: 15_000 });
    await page.waitForTimeout(800);
    await capture('05-research-start', 1440, 900);

    // Start research (panel header primary button)
    const startBtn = page.locator('[data-testid="research-panel"] button').filter({ hasText: /^Deep Research$/ }).last();
    if ((await startBtn.count()) > 0) {
      await startBtn.click();
      await page.waitForTimeout(2000);
      await capture('06-research-running', 1440, 900, 600);
      try {
        await page.locator('[data-testid="research-report"]').waitFor({ timeout: 240_000 });
        await page.waitForTimeout(1200);
        await capture('07-research-complete', 1440, 900);
        await page.locator('[data-testid="research-next-action"]').waitFor({ timeout: 5000 }).catch(() => {});
        await capture('07b-research-next-action', 1440, 900);
      } catch {
        await capture('07c-research-failed', 1440, 900);
      }
    }

    // Thesis
    await page.locator('[aria-label="投资逻辑"], [aria-label="Thesis"]').first().click();
    await page.locator('[data-testid="thesis-panel"]').waitFor({ timeout: 15_000 });
    await page.waitForTimeout(1000);
    await capture('08-thesis', 1440, 900);

    // Portfolio
    await page.locator('[aria-label="投资组合"], [aria-label="Portfolio"]').first().click();
    await page.waitForTimeout(2500);
    await capture('09-portfolio', 1440, 900);

    // Settings
    await page.locator('[aria-label="设置"], [aria-label="Settings"]').first().click();
    await page.waitForTimeout(1200);
    await capture('10-settings', 1440, 900);

    // Agent panel context (NVDA selected)
    await page.locator('[aria-label="研究"], [aria-label="Research"]').first().click();
    await page.waitForTimeout(600);
    await capture('11-agent-context', 1440, 900);
  } finally {
    await browser?.close().catch(() => undefined);
    proc.kill();
  }
  console.log('UX AUDIT DONE →', outDir);
}

void main().catch((e) => {
  console.error(e?.stack ?? e);
  process.exitCode = 1;
});
