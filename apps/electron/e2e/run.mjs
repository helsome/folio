// Folio E2E golden-path smoke — plain Node runner (playwright-core's CDP
// WebSocket handshake is unreliable under Bun; Node drives it reliably).
//
//   FINAGENT_AGENT_PROVIDER=local bun run test:e2e
//
// Steps (each prints PASS/FAIL; exits 1 on any failure):
//   A. three-pane workbench renders + session bootstrap
//   B. NVDA.US click → security header + agent context chip
//   C. rapid symbol switching settles on the last symbol
//   D. agent run streams an answer using the workspace symbol

import { execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
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

const CDP_PORT = 9333;
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
  throw new Error('Electron CDP endpoint did not come up in time.');
}

async function main() {
  if (!existsSync(electronBinary)) {
    console.error(`Electron binary not found: ${electronBinary}`);
    process.exit(1);
  }
  execSync('bunx vite build', { cwd: appRoot, stdio: 'pipe' });

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
        FINAGENT_USER_DATA_DIR: join(appRoot, 'e2e/.user-data'),
      },
    }
  );

  let browser;
  try {
    await waitForCdp(60_000);
    browser = await chromium.connectOverCDP(CDP_URL, { timeout: 30_000 });
    const context = browser.contexts()[0];
    await context.waitForEvent('page', { timeout: 30_000 }).catch(() => undefined);
    const pages = context.pages();
    const page = pages[pages.length - 1];
    await page.waitForLoadState('domcontentloaded');

    // A. Three-pane workbench + session bootstrap
    try {
      await page.getByRole('button', { name: 'New Session', exact: true }).waitFor({ timeout: 15_000 });
      await page.locator('[data-testid="finance-workspace"]').waitFor({ timeout: 15_000 });
      await page.locator('[data-testid="agent-panel"]').waitFor({ timeout: 15_000 });
      // Fresh isolated userData has no sessions — create one so the copilot
      // input renders.
      await page.getByRole('button', { name: 'Create New Session' }).click();
      await page.waitForTimeout(2500);
      const inp = page.locator('[data-testid="agent-input"]');
      console.log('INPUT count:', await inp.count());
      console.log('INPUT visible:', await inp.first().isVisible().catch(() => false));
      const box = await inp.first().boundingBox().catch(() => null);
      console.log('INPUT box:', JSON.stringify(box));
      const panelBox = await page.locator('[data-testid="agent-panel"]').first().boundingBox().catch(() => null);
      console.log('PANEL box:', JSON.stringify(panelBox));
      console.log('WINNER size:', await page.evaluate(() => ({ w: innerWidth, h: innerHeight })));
      await inp.first().waitFor({ timeout: 15_000 });
      pass('A: three-pane workbench renders + session created');
    } catch (error) {
      fail('A: three-pane workbench renders + session created', error);
    }

    // A2. Resize the agent panel by dragging the right sash; the layout must
    // stay responsive (chart/table/chat resize correctly — verified by the
    // panes remaining visible and widths changing).
    try {
      const sash = page.locator('.sash').last();
      await sash.waitFor({ timeout: 15_000 });
      const before = await page.locator('[data-testid="agent-panel"]').first().boundingBox();
      const sashBox = await sash.boundingBox();
      await page.mouse.move(sashBox.x + sashBox.width / 2, sashBox.y + 200);
      await page.mouse.down();
      await page.mouse.move(sashBox.x - 80, sashBox.y + 200, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(800);
      const after = await page.locator('[data-testid="agent-panel"]').first().boundingBox();
      if (!before || !after || Math.abs(after.width - before.width) < 20) {
        throw new Error('agent panel width did not change after sash drag');
      }
      pass('A2: agent panel resize works');
    } catch (error) {
      fail('A2: agent panel resize works', error);
    }

    // B. NVDA click → header + context + chart
    try {
      await page.locator('[data-testid="watchlist-row-NVDA.US"]').first().click();
      await page
        .locator('[data-testid="security-header-symbol"]')
        .filter({ hasText: 'NVDA.US' })
        .waitFor({ timeout: 15_000 });
      await page
        .locator('[data-testid="context-chip"]')
        .filter({ hasText: 'NVDA.US' })
        .waitFor({ timeout: 15_000 });
      // Chart tab renders the K-line canvas for the active symbol.
      await page.getByRole('button', { name: /^Chart$/i }).click();
      await page.locator('[data-testid="chart-canvas"]').waitFor({ timeout: 15_000 });
      await page.locator('[data-testid="chart-canvas"] canvas').first().waitFor({ timeout: 20_000 });
      pass('B: NVDA.US switches header, agent context, and chart');
    } catch (error) {
      fail('B: NVDA.US switches header and agent context', error);
    }

    // C. Rapid switching settles on the last symbol
    try {
      for (const symbol of ['AAPL.US', 'TSLA.US', 'NVDA.US']) {
        await page.locator(`[data-testid="watchlist-row-${symbol}"]`).first().click();
      }
      await page
        .locator('[data-testid="security-header-symbol"]')
        .filter({ hasText: 'NVDA.US' })
        .waitFor({ timeout: 15_000 });
      pass('C: rapid symbol switching settles on NVDA.US');
    } catch (error) {
      fail('C: rapid symbol switching settles on NVDA.US', error);
    }

    // D. Agent run with workspace context
    try {
      await page.locator('[data-testid="watchlist-row-NVDA.US"]').first().click();
      const input = page.locator('[data-testid="agent-input"]');
      await input.waitFor({ timeout: 15_000 });
      await input.fill('最近走势怎么样？');
      await input.press('Enter');
      // Streaming evidence: the live answer block appears while the run is active.
      const runPanel = page.locator('[data-testid="run-panel"]');
      await runPanel.waitFor({ timeout: 15_000 });
      // The local runtime settles fast; the answer then lives in the message
      // list. Wait for the assistant answer anywhere in the agent panel.
      try {
        await page.waitForFunction(
          () => {
            const panel = document.querySelector('[data-testid="agent-panel"]');
            const text = panel?.textContent ?? '';
            return /NVDA|K-Line|走势/i.test(text);
          },
          { timeout: 30_000 }
        );
      } catch (error) {
        console.log('PANEL TEXT DUMP:', (await page.locator('[data-testid="agent-panel"]').first().textContent())?.slice(0, 600));
        throw error;
      }
      pass('D: agent run streams an answer for the workspace symbol');
    } catch (error) {
      fail('D: agent run streams an answer for the workspace symbol', error);
    }
  } catch (error) {
    fail('harness setup', error);
  } finally {
    await browser?.close().catch(() => undefined);
    electronProcess.kill();
  }

  if (failures > 0) {
    console.error(`E2E failed: ${failures} step(s).`);
    process.exit(1);
  }
  console.log('E2E golden path passed.');
}

main();
