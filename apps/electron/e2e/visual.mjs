// Folio UI visual QA. Captures the main workbench states at the target sizes
// from the V6 brief so screenshots can be inspected alongside E2E assertions.

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
const cdpPort = 9351;
const cdpUrl = `http://127.0.0.1:${cdpPort}`;
const userDataDir = join(appRoot, 'e2e/.user-data-visual');
const outputDir = join(appRoot, 'e2e/artifacts/ui');

async function waitForCdp(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${cdpUrl}/json/version`);
      if (response.ok) return;
    } catch {
      // Electron is still starting.
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
  throw new Error('No renderer page appeared in time.');
}

async function main() {
  if (!existsSync(electronBinary)) throw new Error(`Electron binary not found: ${electronBinary}`);
  try {
    execSync(`pkill -f 'remote-debugging-port=${cdpPort}' || true`, { stdio: 'ignore' });
  } catch {
    // No stale process.
  }

  execSync('bun run build:preload', { cwd: appRoot, stdio: 'pipe' });
  execSync('bunx vite build', { cwd: appRoot, stdio: 'pipe' });
  rmSync(userDataDir, { recursive: true, force: true });
  mkdirSync(userDataDir, { recursive: true });
  seedLocale(userDataDir, 'en-US');
  mkdirSync(outputDir, { recursive: true });

  const electronProcess = spawn(
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
    await page.getByRole('button', { name: 'New Session', exact: true }).waitFor({ timeout: 15_000 });
    await page.getByRole('button', { name: 'New Session', exact: true }).click();
    await page.locator('[data-testid="agent-input"]').waitFor({ timeout: 15_000 });

    async function capture(name, width, height, settle = 650) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(settle);
      const actual = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      const path = join(outputDir, `${name}-${width}x${height}.png`);
      await page.screenshot({ path, animations: 'disabled' });
      console.log(`CAPTURE ${name} ${width}x${height} → ${path} (viewport ${actual.width}x${actual.height})`);
    }

    await page.getByRole('button', { name: /^Today$/i }).first().click();
    await page.locator('[data-testid="today-view"]').waitFor({ timeout: 15_000 });
    await capture('today', 1440, 900);

    await page.getByRole('button', { name: /^Discover$/i }).first().click();
    await page.locator('[data-testid="discover-view"]').waitFor({ timeout: 15_000 });
    await capture('discover', 1280, 800);

    await page.getByRole('button', { name: 'Workspace', exact: true }).click();
    await page.getByRole('button', { name: 'Watchlist', exact: true }).click();
    await page.locator('[data-testid="watchlist-row-NVDA.US"]').first().click();
    await page.locator('[data-testid="security-header-symbol"]').filter({ hasText: 'NVDA.US' }).waitFor({ timeout: 15_000 });
    await capture('security-workbench', 1440, 900);

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByText('Preferences', { exact: true }).waitFor({ timeout: 15_000 });
    await capture('settings', 1280, 800);
  } finally {
    await browser?.close().catch(() => undefined);
    electronProcess.kill();
  }
}

void main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
