// Fresh-install release E2E (spec §63, §70): clean userData, no repo, no .env —
// a simulated new user's first launch of the PACKAGED app.
//
//   node e2e/fresh-install.mjs
//
// Steps:
//   F1. First launch → onboarding wizard appears (Welcome + disclaimers)
//   F2. Continue is gated until disclaimers are accepted; accepting unlocks it
//   F3. Step 2 (Connect AI) renders; Skip completes the wizard
//   F4. Wizard hides; workbench renders
//   F5. Relaunch → wizard does NOT reappear (completion persisted)
//
// The Longbridge CLI is hidden from PATH so the app sees a brand-new user
// (no provider connected → wizard gate opens).

import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..');
const repoRoot = join(here, '../../..');
const distDir = join(repoRoot, 'dist', 'electron');
const CDP_PORT = 9347;
const userDataDir = join(appRoot, 'e2e/.user-data-fresh');

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
  console.error(String(error?.stack ?? error).slice(0, 1600));
}

// Strip the Longbridge CLI from PATH (a fresh user has no CLI).
function freshUserEnv() {
  const lbDir = execSync('dirname "$(which longbridge 2>/dev/null)" 2>/dev/null || echo /nonexistent', {
    shell: '/bin/bash',
  })
    .toString()
    .trim();
  const pathEntries = (process.env.PATH ?? '').split(':').filter((entry) => entry !== lbDir);
  return {
    ...process.env,
    PATH: pathEntries.join(':'),
    FINAGENT_AGENT_PROVIDER: 'local',
    FINAGENT_E2E: '1',
    FINAGENT_E2E_HIDDEN: '1',
    FINAGENT_USER_DATA_DIR: userDataDir,
  };
}

function launch() {
  return spawn(packagedBinary, [`--remote-debugging-port=${CDP_PORT}`, '--no-sandbox'], {
    cwd: repoRoot,
    stdio: 'ignore',
    env: freshUserEnv(),
  });
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
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (response.ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Packaged app CDP endpoint did not come up in time.');
}

async function main() {
  const packagedBinary = findAppBinary();
  try {
    execSync("pkill -f 'remote-debugging-port=9347' || true", { stdio: 'ignore' });
  } catch {
    // Nothing to clean.
  }
  rmSync(userDataDir, { recursive: true, force: true });
  mkdirSync(userDataDir, { recursive: true });

  let child = launch();
  try {
    await waitForCdp(90_000);
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`, { timeout: 30_000 });
    const context = browser.contexts()[0];
    await context.waitForEvent('page', { timeout: 30_000 }).catch(() => undefined);
    const page = context.pages()[context.pages().length - 1];
    await page.waitForLoadState('domcontentloaded');

    // F1. Onboarding wizard appears for a brand-new user.
    try {
      await page.locator('[data-testid="onboarding-overlay"]').waitFor({ timeout: 30_000 });
      await page.locator('[data-testid="onboarding-wizard"]').waitFor({ timeout: 15_000 });
      const welcome = await page.locator('[data-testid="onboarding-wizard"]').textContent();
      if (!/Welcome to Folio/.test(welcome ?? '')) throw new Error('Welcome text missing');
      pass('F1: fresh install shows onboarding wizard');
    } catch (error) {
      fail('F1: fresh install shows onboarding wizard', error);
    }

    // F2. Continue gated on disclaimers.
    try {
      const cont = page.locator('[data-testid="onboarding-continue"]');
      const disabledBefore = await cont.isDisabled();
      await page.locator('[data-testid="disclaimer-accept"]').click();
      await page.waitForTimeout(200);
      const disabledAfter = await cont.isDisabled();
      if (!disabledBefore) throw new Error('Continue was enabled before accepting disclaimers');
      if (disabledAfter) throw new Error('Continue stayed disabled after accepting disclaimers');
      pass('F2: disclaimers gate Continue');
    } catch (error) {
      fail('F2: disclaimers gate Continue', error);
    }

    // F3. Step 2 (Connect AI) renders; Skip completes the wizard.
    try {
      await page.locator('[data-testid="onboarding-continue"]').click();
      await page.waitForTimeout(400);
      const stepText = await page.locator('[data-testid="onboarding-wizard"]').textContent();
      if (!/Connect AI/i.test(stepText ?? '')) throw new Error('Connect AI step not shown');
      await page.locator('[data-testid="onboarding-skip"]').click();
      await page.waitForTimeout(500);
      const flag = await page.evaluate(() => localStorage.getItem('folio.onboarding.completed.v1'));
      console.log('COMPLETED FLAG AFTER SKIP:', JSON.stringify(flag));
      pass('F3: wizard advances to Connect AI and Skip completes it');
    } catch (error) {
      fail('F3: wizard advances to Connect AI and Skip completes it', error);
    }

    // F4. Wizard hides; the workbench renders.
    try {
      await page.locator('[data-testid="onboarding-overlay"]').waitFor({ state: 'detached', timeout: 15_000 });
      await page.locator('[data-testid="finance-workspace"]').waitFor({ timeout: 15_000 });
      pass('F4: wizard hides and workbench renders');
    } catch (error) {
      fail('F4: wizard hides and workbench renders', error);
    }

    await browser.close();
  } catch (error) {
    fail('harness setup', error);
  } finally {
    shutdown(child)
  }

  // F5. Relaunch: onboarding must NOT reappear.
  child = launch();
  try {
    await waitForCdp(90_000);
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`, { timeout: 30_000 });
    const context = browser.contexts()[0];
    await context.waitForEvent('page', { timeout: 30_000 }).catch(() => undefined);
    const page = context.pages()[context.pages().length - 1];
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(4000);
    const flag2 = await page.evaluate(() => localStorage.getItem('folio.onboarding.completed.v1'));
    console.log('COMPLETED FLAG ON RELAUNCH:', JSON.stringify(flag2));
    const overlayGone = (await page.locator('[data-testid="onboarding-overlay"]').count()) === 0;
    if (!overlayGone) throw new Error('Onboarding overlay reappeared after restart');
    await page.locator('[data-testid="finance-workspace"]').waitFor({ timeout: 15_000 });
    pass('F5: relaunch preserves completion (no wizard)');
    await browser.close();
  } catch (error) {
    fail('F5: relaunch preserves completion (no wizard)', error);
  } finally {
    shutdown(child)
  }

  if (failures > 0) {
    console.error(`Fresh-install E2E failed: ${failures} failure(s).`);
    process.exit(1);
  }
  console.log('Fresh-install E2E passed.');
}

void main();
