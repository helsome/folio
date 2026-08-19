// V9 focused verification — asserts the new UX elements exist and behave:
// research symbol entry, next-action, context chip with section, semantic tool
// activity, thesis empty state, holding research action.
import { execSync, spawn } from 'node:child_process';
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
const electronBinary = join(repoRoot, 'node_modules/.bun/electron@39.8.9/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const cdpPort = 9367;
const cdpUrl = `http://127.0.0.1:${cdpPort}`;
const userDataDir = join(appRoot, 'e2e/.user-data-v9verify');
const outDir = join(appRoot, 'e2e/artifacts/v9-verify');

async function waitForCdp(t) { const d = Date.now() + t; while (Date.now() < d) { try { const r = await fetch(`${cdpUrl}/json/version`); if (r.ok) return; } catch {} await new Promise((r) => setTimeout(r, 250)); } throw new Error('cdp timeout'); }
async function waitForPage(ctx, t) { const d = Date.now() + t; while (Date.now() < d) { const pages = ctx.pages(); if (pages.length > 0) return pages[pages.length - 1]; await new Promise((r) => setTimeout(r, 250)); } throw new Error('no page'); }

async function main() {
  try { execSync(`pkill -f 'remote-debugging-port=${cdpPort}' || true`, { stdio: 'ignore' }); } catch {}
  execSync('bun run build:preload', { cwd: appRoot, stdio: 'pipe' });
  execSync('bunx vite build', { cwd: appRoot, stdio: 'pipe' });
  rmSync(userDataDir, { recursive: true, force: true });
  mkdirSync(userDataDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  const { seedLocale } = await import('./seed-locale.mjs');
  seedLocale(userDataDir, 'en-US');
  const proc = spawn(electronBinary, [electronMain, `--remote-debugging-port=${cdpPort}`, '--no-sandbox'], {
    cwd: repoRoot, stdio: 'ignore',
    env: { ...process.env, FINAGENT_AGENT_PROVIDER: 'local', FINAGENT_FORCE_PROD_LOAD: '1', FINAGENT_E2E: '1', FINAGENT_E2E_HIDDEN: '1', FINAGENT_USER_DATA_DIR: userDataDir },
  });
  let browser;
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push(['PASS', name]); console.log('PASS', name); }
    catch (e) { results.push(['FAIL', name, String(e).slice(0, 300)]); console.log('FAIL', name, String(e).slice(0, 300)); }
  };
  const capture = async (name) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(outDir, `${name}.png`), animations: 'disabled' });
  };
  let page;
  try {
    await waitForCdp(60_000);
    browser = await chromium.connectOverCDP(cdpUrl, { timeout: 30_000 });
    page = await waitForPage(browser.contexts()[0], 30_000);
    await page.waitForLoadState('domcontentloaded');
    await page.locator('[data-testid="finance-workspace"]').waitFor({ timeout: 30_000 });
    await page.getByRole('button', { name: 'New Session', exact: true }).waitFor({ timeout: 15_000 });
    await page.getByRole('button', { name: 'New Session', exact: true }).click();
    await page.locator('[data-testid="agent-input"]').first().waitFor({ timeout: 15_000 });

    // 1. Research with no symbol → symbol entry (no dead-end)
    await page.getByRole('button', { name: 'Research', exact: true }).first().click();
    await page.locator('[data-testid="research-panel"]').waitFor({ timeout: 15_000 });
    await check('research-no-symbol shows symbol entry', async () => {
      await page.locator('[data-testid="research-symbol-entry"]').waitFor({ timeout: 5000 });
    });
    await capture('v9-research-symbol-entry');

    // invalid symbol shows error
    await page.locator('[data-testid="research-symbol-input"]').fill('BADINPUT');
    await page.locator('[data-testid="research-symbol-submit"]').click();
    await check('research invalid symbol shows inline error', async () => {
      await page.getByText(/Invalid symbol/i).waitFor({ timeout: 3000 });
    });

    // 2. Pick a watchlist symbol → research start + context chip section label
    await page.getByRole('button', { name: 'Workspace', exact: true }).click();
    await page.locator('[data-testid="watchlist-row-NVDA.US"]').first().click();
    await page.getByRole('button', { name: 'Research', exact: true }).first().click();
    await page.locator('[data-testid="research-panel"]').waitFor({ timeout: 15_000 });
    await check('research-with-symbol shows strategy picker', async () => {
      await page.locator('[data-testid="strategy-picker"]').waitFor({ timeout: 5000 });
    });
    // Strategy memory: pick Growth, leave, come back → Growth stays selected.
    await page.locator('[data-testid="strategy-card-growth"]').click();
    await page.getByRole('button', { name: 'Today', exact: true }).first().click();
    await page.locator('[data-testid="today-view"]').waitFor({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Research', exact: true }).first().click();
    await page.locator('[data-testid="research-panel"]').waitFor({ timeout: 10_000 });
    await check('strategy memory keeps last choice for symbol', async () => {
      const growth = page.locator('[data-testid="strategy-card-growth"]');
      await growth.waitFor({ timeout: 5000 });
      const attrs = await growth.evaluate((el) => { const a = {}; for (const n of el.attributes) a[n.name] = n.value; return a; });
      const stored = await page.evaluate(() => localStorage.getItem('folio.prefs.lastStrategy.NVDA.US'));
      if (!stored) throw new Error('no persisted strategy, attrs=' + JSON.stringify(attrs));
      if (!/growth/.test(stored)) throw new Error('persisted wrong strategy: ' + stored);
    });
    await check('context chip shows Research · NVDA.US', async () => {
      const chip = page.locator('[data-testid="context-chip"]');
      await chip.waitFor({ timeout: 5000 });
      const text = await chip.textContent();
      if (!/Research/.test(text) || !/NVDA\.US/.test(text)) throw new Error(`chip="${text}"`);
    });
    await capture('v9-research-start-context');

    // 3. Thesis empty state with action (no symbol → clears)
    await page.locator('[data-testid="context-chip"] button').first().click().catch(() => {});
    await page.getByRole('button', { name: 'Thesis', exact: true }).first().click();
    await page.locator('[data-testid="thesis-panel"]').waitFor({ timeout: 15_000 });
    await check('thesis-no-symbol shows guided empty state', async () => {
      await page.getByText(/Track your investment logic|Start Research/i).first().waitFor({ timeout: 5000 });
    });
    await capture('v9-thesis-empty');

    // 4. Portfolio holding row has Research action
    await page.getByRole('button', { name: 'Portfolio', exact: true }).first().click();
    await page.getByText('Total Value').first().waitFor({ timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(1200);
    await check('holding row has research action', async () => {
      const btn = page.locator('[data-testid^="holding-research-"]').first();
      await btn.waitFor({ timeout: 10_000 });
      if (!(await btn.isVisible())) throw new Error('not visible');
    });
    await capture('v9-portfolio-holdings');

    // 5. Agent suggestions (empty conversation) follow the section
    await page.getByRole('button', { name: 'Research', exact: true }).first().click();
    await page.locator('[data-testid="research-panel"]').waitFor({ timeout: 15_000 });
    await check('agent suggestions contextual (research prompts)', async () => {
      await page.locator('[data-testid="agent-suggestions"]').waitFor({ timeout: 5000 });
      const text = await page.locator('[data-testid="agent-suggestions"]').textContent();
      if (!/Why did you reach|conclusion|risk/i.test(text)) throw new Error('suggestions not contextual');
    });

    // 6. Settings advanced grouping
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await page.waitForTimeout(800);
    await check('settings shows Advanced group label', async () => {
      await page.getByText('Advanced', { exact: true }).first().waitFor({ timeout: 5000 });
    });

    // 8. Agent run → semantic tool activity labels
    await page.locator('[data-testid="agent-input"]').first().fill('What is NVDA doing today?');
    await page.locator('[data-testid="agent-input"]').first().press('Enter');
    await page.waitForTimeout(4000);
    const panelText = await page.locator('[data-testid="agent-panel"]').first().textContent().catch(() => '');
    const hasSemantic = /Quote|Financials|News|portfolio/i.test(panelText) && !panelText.includes('get_quote');
    await check('agent activity uses semantic labels', async () => {
      if (!hasSemantic) throw new Error(`panel="${panelText.replace(/\s+/g,' ').slice(0,200)}"`);
    });
    await capture('v9-agent-activity');
  } finally {
    await browser?.close().catch(() => undefined);
    proc.kill();
  }
  const failed = results.filter((r) => r[0] === 'FAIL');
  console.log(`\nV9 VERIFY: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) process.exitCode = 1;
}
void main().catch((e) => { console.error(e?.stack ?? e); process.exitCode = 1; });
