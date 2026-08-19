// Folio V9 DOM audit — dumps visible structure (headings, buttons, empty/error
// states, alerts) for each major view so UX can be reviewed textually.
import { execSync, spawn } from 'node:child_process';
import { seedLocale } from './seed-locale.mjs';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
const cdpPort = 9363;
const cdpUrl = `http://127.0.0.1:${cdpPort}`;
const userDataDir = join(appRoot, 'e2e/.user-data-domaudit');
const outFile = join(appRoot, 'e2e/artifacts/dom-audit.json');

async function waitForCdp(t) {
  const d = Date.now() + t;
  while (Date.now() < d) {
    try { const r = await fetch(`${cdpUrl}/json/version`); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('CDP timeout');
}
async function waitForPage(ctx, t) {
  const d = Date.now() + t;
  while (Date.now() < d) {
    const pages = ctx.pages();
    if (pages.length > 0) return pages[pages.length - 1];
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('no page');
}

const dump = async (page) => {
  return page.evaluate(() => {
    const visible = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const headings = [...document.querySelectorAll('h1,h2,h3,h4,[role="heading"]')].filter(visible).map((h) => h.textContent.trim().replace(/\s+/g, ' ').slice(0, 80));
    const buttons = [...document.querySelectorAll('button')].filter(visible).map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60)).filter(Boolean);
    const inputs = [...document.querySelectorAll('input,textarea,select')].filter(visible).map((i) => (i.getAttribute('placeholder') || i.tagName + (i.getAttribute('aria-label') || '')).slice(0, 50));
    const alerts = [...document.querySelectorAll('[role="alert"], [role="status"]')].filter(visible).map((a) => a.textContent.trim().replace(/\s+/g, ' ').slice(0, 200));
    const empty = [...document.querySelectorAll('[data-testid*="empty"], [data-testid*="Empty"]')].filter(visible).map((e) => e.textContent.trim().replace(/\s+/g, ' ').slice(0, 200));
    const error = [...document.querySelectorAll('[data-testid*="error"], [data-testid*="Error"], [data-testid*="banner"], [data-testid*="warning"]')].filter(visible).map((e) => e.textContent.trim().replace(/\s+/g, ' ').slice(0, 200));
    return { headings, buttons, inputs, alerts, empty, error };
  });
};

async function main() {
  try { execSync(`pkill -f 'remote-debugging-port=${cdpPort}' || true`, { stdio: 'ignore' }); } catch {}
  execSync('bun run build:preload', { cwd: appRoot, stdio: 'pipe' });
  execSync('bunx vite build', { cwd: appRoot, stdio: 'pipe' });
  rmSync(userDataDir, { recursive: true, force: true });
  mkdirSync(userDataDir, { recursive: true });
  seedLocale(userDataDir, 'en-US');
  const proc = spawn(electronBinary, [electronMain, `--remote-debugging-port=${cdpPort}`, '--no-sandbox'], {
    cwd: repoRoot, stdio: 'ignore',
    env: { ...process.env, FINAGENT_AGENT_PROVIDER: 'local', FINAGENT_FORCE_PROD_LOAD: '1', FINAGENT_E2E: '1', FINAGENT_E2E_HIDDEN: '1', FINAGENT_USER_DATA_DIR: userDataDir },
  });
  const report = {};
  let browser;
  try {
    await waitForCdp(60_000);
    browser = await chromium.connectOverCDP(cdpUrl, { timeout: 30_000 });
    const page = await waitForPage(browser.contexts()[0], 30_000);
    await page.waitForLoadState('domcontentloaded');
    await page.locator('[data-testid="finance-workspace"]').waitFor({ timeout: 30_000 });
    await page.locator('[aria-label="今日"], [aria-label="Today"]').first().click();
    await page.locator('[data-testid="today-view"]').waitFor({ timeout: 30_000 });
    await page.waitForTimeout(3000);
    report['today-first-user'] = await dump(page);

    await page.locator('[aria-label="机会发现"], [aria-label="Discover"]').first().click();
    await page.locator('[data-testid="discover-view"]').waitFor({ timeout: 15_000 });
    await page.waitForTimeout(1000);
    report['discover-browse'] = await dump(page);

    await page.locator('[data-testid^="discover-run-"]').first().click();
    try {
      await page.locator('[data-testid="discover-results"]').waitFor({ timeout: 120_000 });
      await page.waitForTimeout(1500);
      report['discover-results'] = await dump(page);
    } catch {
      report['discover-results'] = { note: 'timeout', ...(await dump(page)) };
    }

    await page.locator('[aria-label="工作台"], [aria-label="Workspace"]').first().click();
    await page.locator('[data-testid="watchlist-row-NVDA.US"]').first().click();
    await page.locator('[aria-label="研究"], [aria-label="Research"]').first().click();
    await page.locator('[data-testid="research-panel"]').waitFor({ timeout: 15_000 });
    await page.waitForTimeout(1000);
    report['research-start'] = await dump(page);

    const startBtn = page.getByRole('button', { name: /研究|Deep Research/i }).first();
    if ((await startBtn.count()) > 0) {
      await startBtn.click();
      await page.waitForTimeout(4000);
      report['research-running'] = await dump(page);
      try {
        await page.locator('[data-testid="research-report"]').waitFor({ timeout: 180_000 });
        await page.waitForTimeout(800);
        report['research-complete'] = await dump(page);
        const nextAction = await page.locator('[data-testid="research-next-action"]').textContent().catch(() => null);
        const reportText = (await page.locator('[data-testid="research-report"]').textContent().catch(() => '')).replace(/\s+/g, ' ').slice(0, 500);
        report['research-next-action-text'] = nextAction;
        report['research-report-text'] = reportText;
      } catch {
        report['research-complete'] = { note: 'timeout' };
      }
    }

    await page.locator('[aria-label="投资逻辑"], [aria-label="Thesis"]').first().click();
    await page.locator('[data-testid="thesis-panel"]').waitFor({ timeout: 15_000 });
    await page.waitForTimeout(800);
    report['thesis'] = await dump(page);

    await page.locator('[aria-label="投资组合"], [aria-label="Portfolio"]').first().click();
    await page.waitForTimeout(2500);
    report['portfolio'] = await dump(page);

    await page.locator('[aria-label="设置"], [aria-label="Settings"]').first().click();
    await page.waitForTimeout(1000);
    report['settings'] = await dump(page);

    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, JSON.stringify(report, null, 2));
    console.log('DOM AUDIT →', outFile);
  } finally {
    await browser?.close().catch(() => undefined);
    proc.kill();
  }
}
void main().catch((e) => { console.error(e?.stack ?? e); process.exitCode = 1; });
