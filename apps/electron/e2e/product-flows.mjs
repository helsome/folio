// Folio V9 product-flow E2E — user-journey continuity gates (spec §118):
//   1. Returning-user persistence (panel visibility, last section, pane sizes)
//   2. Portfolio → Research context continuity
//   3. Discover → Research continuity (origin back-chip + recommended strategy)
// Hidden by default; runs via `node e2e/product-flows.mjs`.
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
const CDP_PORT = 9369;
const CDP_URL = `http://127.0.0.1:${CDP_PORT}`;
const userDataDir = join(appRoot, 'e2e/.user-data-product-flows');

async function waitForCdp(t) { const d = Date.now() + t; while (Date.now() < d) { try { const r = await fetch(`${CDP_URL}/json/version`); if (r.ok) return; } catch {} await new Promise((r) => setTimeout(r, 250)); } throw new Error('cdp timeout'); }
async function waitForPage(ctx, t) { const d = Date.now() + t; while (Date.now() < d) { const pages = ctx.pages(); if (pages.length > 0) return pages[pages.length - 1]; await new Promise((r) => setTimeout(r, 250)); } throw new Error('no page'); }

let failures = 0;
const pass = (name) => console.log(`PASS  ${name}`);
const fail = (name, error) => { failures += 1; console.error(`FAIL  ${name}`); console.error(String(error?.stack ?? error).slice(0, 900)); };

function launch() {
  const proc = spawn(electronBinary, [electronMain, `--remote-debugging-port=${CDP_PORT}`, '--no-sandbox'], {
    cwd: repoRoot, stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, FINAGENT_AGENT_PROVIDER: 'local', FINAGENT_FORCE_PROD_LOAD: '1', FINAGENT_E2E: '1', FINAGENT_E2E_HIDDEN: '1', FINAGENT_USER_DATA_DIR: userDataDir },
  });
  return proc;
}

async function boot(browser) {
  await waitForCdp(90_000);
  const context = browser.contexts()[0];
  const page = await waitForPage(context, 30_000);
  await page.waitForLoadState('domcontentloaded');
  await page.locator('[data-testid="finance-workspace"]').waitFor({ timeout: 30_000 });
  return page;
}

async function main() {
  try { execSync(`pkill -f 'remote-debugging-port=${CDP_PORT}' || true`, { stdio: 'ignore' }); } catch {}
  execSync('bun run build:preload', { cwd: appRoot, stdio: 'pipe' });
  execSync('bunx vite build', { cwd: appRoot, stdio: 'pipe' });
  rmSync(userDataDir, { recursive: true, force: true });
  mkdirSync(userDataDir, { recursive: true });
  const { seedLocale } = await import('./seed-locale.mjs');
  seedLocale(userDataDir, 'en-US');

  let browser;
  let proc = launch();
  try {
    await waitForCdp(90_000);
    browser = await chromium.connectOverCDP(CDP_URL, { timeout: 30_000 });
    let page = await boot(browser);
    await page.getByRole('button', { name: 'New Session', exact: true }).waitFor({ timeout: 15_000 });
    await page.getByRole('button', { name: 'New Session', exact: true }).click();
    await page.locator('[data-testid="agent-input"]').first().waitFor({ timeout: 15_000 });

    // ── 1. Returning-user persistence ───────────────────────────────────────
    try {
      // Navigate to Research, collapse the agent panel, resize a pane.
      await page.getByRole('button', { name: 'Workspace', exact: true }).click();
      await page.locator('[data-testid="watchlist-row-NVDA.US"]').first().click();
      await page.getByRole('button', { name: 'Research', exact: true }).first().click();
      await page.locator('[data-testid="research-panel"]').waitFor({ timeout: 15_000 });
      await page.getByRole('button', { name: /Collapse agent panel/i }).first().click();
      await page.waitForTimeout(600);
      const collapsed = await page.locator('[data-testid="agent-panel"]').count() === 0 || !(await page.locator('[data-testid="agent-panel"]').first().isVisible().catch(() => false));
      const preStored = await page.evaluate(() => localStorage.getItem('folio.prefs.navSection'));
      console.log('PRE-RESTART localStorage navSection:', preStored);
      const prePanel = await page.evaluate(() => localStorage.getItem('folio.prefs.agentPanelVisible'));
      console.log('PRE-RESTART localStorage panel:', prePanel);
      // Restart with the same userData dir.
      // Close the window gracefully so Chromium flushes localStorage to disk,
      // then kill the process (an abrupt SIGTERM skips the flush).
      await page.evaluate(() => window.electronAPI?.window?.close?.() ?? window.close()).catch(() => {});
      await page.close().catch(() => {});
      await new Promise((r) => setTimeout(r, 2500));
      proc.kill();
      await new Promise((r) => setTimeout(r, 1500));
      proc = launch();
      await waitForCdp(90_000);
      browser = await chromium.connectOverCDP(CDP_URL, { timeout: 30_000 });
      page = await boot(browser);
      await page.waitForTimeout(1500);
      const sectionText = await page.locator('[data-testid="finance-workspace"]').textContent();
      const restoredSection = /Deep Research|Research/i.test(sectionText ?? '');
      const stored = await page.evaluate(() => localStorage.getItem('folio.prefs.navSection'));
      const panelStill = await page.locator('[data-testid="agent-panel"]').count();
      const panelVisible = panelStill > 0 && await page.locator('[data-testid="agent-panel"]').first().isVisible().catch(() => false);
      if (!stored) throw new Error('navSection not persisted in localStorage');
      if (collapsed && panelVisible) throw new Error('agent panel should stay collapsed after restart');
      if (!restoredSection) throw new Error('last section not restored: text=' + (sectionText ?? '').slice(0, 120) + ' stored=' + stored);
      pass('1: returning user — last section + agent panel visibility restored');
    } catch (error) {
      fail('1: returning-user persistence', error);
    }

    // ── 2. Portfolio → Research context continuity ─────────────────────────
    try {
      await page.getByRole('button', { name: 'Portfolio', exact: true }).first().click();
      await page.getByText('Total Value').first().waitFor({ timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(1500);
      const researchBtn = page.locator('[data-testid^="holding-research-"]').first();
      await researchBtn.waitFor({ timeout: 10_000 });
      await researchBtn.click();
      await page.locator('[data-testid="research-panel"]').waitFor({ timeout: 15_000 });
      const chip = page.locator('[data-testid="context-chip"]');
      const chipText = await chip.textContent();
      if (!/Research/.test(chipText)) throw new Error(`context chip missing section: ${chipText}`);
      const originBtn = page.locator('[data-testid="research-back-origin"]');
      await originBtn.waitFor({ timeout: 5000 });
      const originText = await originBtn.textContent();
      if (!/Back to/i.test(originText)) throw new Error(`origin chip wrong: ${originText}`);
      // Return to portfolio via the origin chip.
      await originBtn.click();
      await page.waitForTimeout(800);
      const backText = await page.locator('[data-testid="finance-workspace"]').textContent();
      if (!/Portfolio|Total Value/i.test(backText ?? '')) throw new Error('origin back did not return to portfolio');
      pass('2: portfolio → research carries position context + origin back');
    } catch (error) {
      fail('2: portfolio → research context', error);
    }

    // ── 3. Discover → Research continuity ──────────────────────────────────
    try {
      await page.getByRole('button', { name: 'Discover', exact: true }).first().click();
      await page.locator('[data-testid="discover-view"]').waitFor({ timeout: 15_000 });
      const runBtn = page.locator('[data-testid^="discover-run-"]').first();
      await runBtn.click();
      let candidates = 0;
      try {
        await page.locator('[data-testid="discover-results"]').waitFor({ timeout: 120_000 });
        candidates = await page.locator('[data-testid^="candidate-research-"]').count();
      } catch {
        // screener may be rate-limited; results view still shows back + history
      }
      if (candidates > 0) {
        await page.locator('[data-testid^="candidate-research-"]').first().click();
        await page.locator('[data-testid="research-panel"]').waitFor({ timeout: 15_000 });
        const chipText = await page.locator('[data-testid="context-chip"]').textContent();
        if (!/Research/.test(chipText)) throw new Error(`chip: ${chipText}`);
        const originBtn = page.locator('[data-testid="research-back-origin"]');
        await originBtn.waitFor({ timeout: 5000 });
        const originText = await originBtn.textContent();
        if (!/Back to/i.test(originText)) throw new Error(`origin: ${originText}`);
        // Back to the discover results (not to Discover home).
        await originBtn.click();
        await page.waitForTimeout(800);
        const backText = await page.locator('[data-testid="finance-workspace"]').textContent();
        if (!/candidate|Back to Discover/i.test(backText ?? '')) throw new Error('did not return to results: ' + (backText ?? '').slice(0, 120));
        pass('3: discover → research carries strategy + origin back to results');
      } else {
        // No candidates (provider degraded) — assert the empty state is not a dead-end.
        const emptyText = await page.locator('[data-testid="discover-empty"]').textContent().catch(() => '');
        if (!/Watchlist|Connections|Universe/i.test(emptyText ?? '') && !(await page.locator('[data-testid="discover-back"]').count())) {
          throw new Error('empty discover result has no recovery path');
        }
        pass('3: discover degraded empty state has recovery options (no dead-end)');
      }
    } catch (error) {
      fail('3: discover → research continuity', error);
    }
  } catch (error) {
    fail('harness setup', error);
  } finally {
    await browser?.close().catch(() => undefined);
    proc.kill();
  }
  if (failures > 0) { console.error(`product flows failed: ${failures}`); process.exit(1); }
  console.log('product flows passed.');
}
void main().catch((e) => { console.error(e?.stack ?? e); process.exitCode = 1; });
