// Folio Skills page interaction test — standalone Node runner over raw CDP
// (playwright-core; the same harness style as e2e/run.mjs). Covers the Skills
// home rework: loading/list, readiness badge, detail drawer, advanced
// expand/collapse, resource content, keyboard activation, and optimistic
// enable/disable toggling.
//
//   FINAGENT_AGENT_PROVIDER=local bun run test:skills-interactions
//
// The IPC-failure path (rollback + inline error) is exercised at unit level in
// packages/ui/src/components/settings/SkillsView.test.tsx with a stubbed
// client; the real main-process handler cannot be forced to fail here.

import { execSync, spawn } from 'node:child_process';
import { seedLocale } from './seed-locale.mjs';
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

const CDP_PORT = 9338;
const CDP_URL = `http://127.0.0.1:${CDP_PORT}`;

// FINAGENT_E2E_KEEP_OPEN=1 — debugging only, NEVER in automated runs: leave
// the app running when the harness finishes and print where it is, instead of
// killing it. Automated runs/CI rely on the harness cleaning up its port.
const KEEP_OPEN = process.env.FINAGENT_E2E_KEEP_OPEN === '1';
function shutdown(appProcess) {
  if (KEEP_OPEN) {
    console.log(
      `KEEP_OPEN CDP port ${CDP_PORT} — app left running; clean up yourself: pkill -f 'remote-debugging-port=${CDP_PORT}'`
    );
    return
  }
  appProcess.kill()
}

let failures = 0;
function pass(name) {
  console.log(`PASS  ${name}`);
}

function fail(name, error) {
  failures += 1;
  console.error(`FAIL  ${name}`);
  console.error(String(error?.stack ?? error).slice(0, 2000));
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
  // Stale instances from interrupted runs hold the CDP port — kill first.
  try {
    execSync("pkill -f 'remote-debugging-port=9338' || true", { stdio: 'ignore' });
  } catch {
    // Nothing to clean.
  }
  execSync('bun run build:preload', { cwd: appRoot, stdio: 'pipe' });
  execSync('bunx vite build', { cwd: appRoot, stdio: 'pipe' });

  const userDataDir = join(appRoot, 'e2e/.user-data');
  execSync(`rm -rf "${userDataDir}"`);
  execSync(`mkdir -p "${userDataDir}"`);
  seedLocale(userDataDir, 'en-US');
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
    browser = await chromium.connectOverCDP(CDP_URL, { timeout: 30_000 });
    const context = browser.contexts()[0];
    const page = await waitForPage(context, 30_000);
    await page.waitForLoadState('domcontentloaded');

    const row = page.locator('[data-testid="skill-row-longbridge"]');
    const switchInRow = page.locator('[data-testid="skill-row-longbridge"] [role="switch"]');
    const drawer = page.locator('[data-testid="skill-detail-drawer"]');

    // S1. Loading → list: search controls render during load, then the list.
    try {
      await page.getByRole('button', { name: 'Skills', exact: true }).waitFor({ timeout: 15_000 });
      await page.getByRole('button', { name: 'Skills', exact: true }).click();
      // Search box renders immediately (part of the loading surface).
      await page.locator('[data-testid="skills-search"]').waitFor({ timeout: 15_000 });
      // The list appears once skills load.
      await page.locator('[data-testid="skill-list"]').waitFor({ timeout: 15_000 });
      await row.waitFor({ timeout: 15_000 });
      pass('S1: skills home loads from a loading surface into the list');
    } catch (error) {
      fail('S1: skills home loads from a loading surface into the list', error);
    }

    // S2. Readiness badge renders on the row.
    try {
      const rowText = (await row.textContent()) ?? '';
      if (!/capabilities|unavailable/i.test(rowText)) {
        throw new Error(`readiness summary missing from row: ${rowText.slice(0, 120)}`);
      }
      pass('S2: readiness badge renders');
    } catch (error) {
      fail('S2: readiness badge renders', error);
    }

    // S3. Search filter narrows and restores the list.
    try {
      const fullCount = await page.locator('[data-testid^="skill-row-"]').count();
      if (fullCount < 2) throw new Error(`expected multiple skills, saw ${fullCount}`);
      await page.locator('[data-testid="skills-search"]').fill('derivatives');
      await page.waitForFunction(
        (expected) => {
          const n = document.querySelectorAll('[data-testid^="skill-row-"]').length;
          return n > 0 && n < expected;
        },
        fullCount,
        { timeout: 15_000 }
      );
      await page.locator('[data-testid="skills-search"]').fill('');
      await page.waitForFunction(
        (expected) => document.querySelectorAll('[data-testid^="skill-row-"]').length === expected,
        fullCount,
        { timeout: 15_000 }
      );
      pass('S3: search filter narrows and restores the list');
    } catch (error) {
      fail('S3: search filter narrows and restores the list', error);
    }

    // S4. Detail open: clicking the row opens the drawer.
    try {
      await row.click();
      await drawer.waitFor({ timeout: 15_000 });
      pass('S4: detail drawer opens on row click');
    } catch (error) {
      fail('S4: detail drawer opens on row click', error);
    }

    // S5. Advanced / Developer Details expand/collapse.
    try {
      const advanced = page.locator('[data-testid="skill-advanced-toggle"]');
      await advanced.waitFor({ timeout: 15_000 });
      await advanced.click();
      await page.waitForFunction(
        () => document.querySelector('[data-testid="skill-advanced-toggle"]')?.getAttribute('aria-expanded') === 'true',
        undefined,
        { timeout: 15_000 }
      );
      // Raw SKILL.md path label appears inside the expanded section.
      await page
        .locator('[data-testid="skill-detail-drawer"]')
        .filter({ hasText: 'SKILL.md' })
        .waitFor({ timeout: 15_000 });
      await advanced.click();
      await page.waitForFunction(
        () => document.querySelector('[data-testid="skill-advanced-toggle"]')?.getAttribute('aria-expanded') === 'false',
        undefined,
        { timeout: 15_000 }
      );
      pass('S5: advanced developer details expand and collapse');
    } catch (error) {
      fail('S5: advanced developer details expand and collapse', error);
    }

    // S6. Resource open renders content.
    try {
      const resource = page.locator('[data-testid="skill-resource-references/setup.md"]');
      await resource.waitFor({ timeout: 15_000 });
      await resource.click();
      const content = page.locator('[data-testid="skill-resource-content"]');
      await content.waitFor({ timeout: 15_000 });
      const contentText = (await content.textContent()) ?? '';
      if (contentText.trim().length === 0) {
        throw new Error('resource content is empty');
      }
      pass('S6: resource open renders its content');
    } catch (error) {
      fail('S6: resource open renders its content', error);
    }

    // S7. Keyboard: Esc closes the drawer and returns focus to the row.
    try {
      await page.keyboard.press('Escape');
      await drawer.waitFor({ state: 'detached', timeout: 15_000 });
      const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
      if (focused !== 'skill-row-longbridge') {
        throw new Error(`focus did not return to the row trigger (active: ${focused})`);
      }
      pass('S7: Escape closes the drawer and restores focus to the trigger');
    } catch (error) {
      fail('S7: Escape closes the drawer and restores focus to the trigger', error);
    }

    // S8. Keyboard: Enter opens the drawer.
    try {
      await row.focus();
      await page.keyboard.press('Enter');
      await drawer.waitFor({ timeout: 15_000 });
      await page.keyboard.press('Escape');
      await drawer.waitFor({ state: 'detached', timeout: 15_000 });
      pass('S8: Enter opens the drawer from the keyboard');
    } catch (error) {
      fail('S8: Enter opens the drawer from the keyboard', error);
    }

    // S9. Optimistic enable/disable toggle (state flips both ways, persists).
    try {
      const before = await switchInRow.getAttribute('aria-checked');
      if (before !== 'true') throw new Error(`expected enabled by default, got ${before}`);
      await switchInRow.click();
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="skill-row-longbridge"] [role="switch"]')?.getAttribute('aria-checked') === 'false',
        undefined,
        { timeout: 15_000 }
      );
      await page.waitForTimeout(300); // allow setEnabled to persist; no rollback
      const disabled = await switchInRow.getAttribute('aria-checked');
      if (disabled !== 'false') throw new Error(`disable did not persist, got ${disabled}`);
      await switchInRow.click();
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="skill-row-longbridge"] [role="switch"]')?.getAttribute('aria-checked') === 'true',
        undefined,
        { timeout: 15_000 }
      );
      const reenabled = await switchInRow.getAttribute('aria-checked');
      if (reenabled !== 'true') throw new Error(`re-enable did not persist, got ${reenabled}`);
      pass('S9: enable/disable toggle flips state and persists');
    } catch (error) {
      fail('S9: enable/disable toggle flips state and persists', error);
    }
  } catch (error) {
    fail('harness setup', error);
  } finally {
    await browser?.close().catch(() => undefined);
    shutdown(electronProcess)
  }

  if (failures > 0) {
    console.error(`Skills interactions E2E failed: ${failures} step(s).`);
    process.exit(1);
  }
  console.log('Skills interactions E2E passed.');
}

main();
