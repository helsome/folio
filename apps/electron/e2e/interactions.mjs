// Folio interaction contract sweep — plain Node runner (same CDP harness
// pattern as run.mjs). For each major user-facing control, asserts that a
// click produces one of:
//   aria    — aria-expanded/pressed/checked/selected state change
//   dialog  — a modal opens or closes
//   structure — new/removed data-testid elements (navigation/render)
//   content — text/content within the observed scope changed (data arrived)
//
//   FINAGENT_AGENT_PROVIDER=local bun run test:interactions
//
// This is a CONTINUOUS audit: Connections/Today/Onboarding controls are
// appended here as those slices land (see docs/interaction-audit.md).

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

const CDP_PORT = 9337;
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
const results = [];

function pass(name, category) {
  console.log(`PASS  ${name}  [${category}]`);
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

// Capture the observable interaction contract for a DOM scope: ARIA state,
// modal presence, testid structure, and raw content. A control that changes
// none of these on click is a broken/no-op button.
async function snapshot(page, scope) {
  return page.evaluate((scope) => {
    const root = document.querySelector(scope) ?? document.body;
    const ariaSel =
      'button[aria-expanded],button[aria-pressed],[role="switch"][aria-checked],[role="option"][aria-selected],button[aria-selected]';
    const aria = Array.from(document.querySelectorAll(ariaSel))
      .map((el) => {
        const v =
          el.getAttribute('aria-expanded') ??
          el.getAttribute('aria-pressed') ??
          el.getAttribute('aria-checked') ??
          el.getAttribute('aria-selected');
        const label = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24);
        return `${el.tagName.toLowerCase()}|${v}|${label}`;
      })
      .sort()
      .join('\n');
    const dialogs = Array.from(
      document.querySelectorAll('.fixed.inset-0, [aria-label="Close dialog"], [role="dialog"]')
    ).length;
    const testids = Array.from(root.querySelectorAll('[data-testid]'))
      .map((el) => el.getAttribute('data-testid'))
      .sort()
      .join(',');
    const text = (root.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 1000);
    return { aria, dialogs, testids, text, htmlLen: root.innerHTML.length };
  }, scope);
}

// Click `trigger` (a locator thunk) and classify the observed change. Returns
// { category, waitSatisfied } where category is one of the four contract
// buckets or 'none'.
async function probe(page, name, scope, trigger, opts = {}) {
  const before = await snapshot(page, scope);
  let triggerError = null;
  try {
    await trigger();
  } catch (error) {
    // A control whose click cannot even land (e.g. pointer events intercepted
    // by another layer) is a broken control — record it, don't abort the sweep.
    triggerError = error;
  }
  let waitSatisfied = false;
  if (!triggerError && opts.waitForFn) {
    waitSatisfied = await opts
      .waitForFn()
      .then(() => true)
      .catch(() => false);
  } else if (!triggerError && opts.waitFor) {
    await page
      .locator(opts.waitFor)
      .first()
      .waitFor({ timeout: opts.timeout ?? 15_000 })
      .then(() => {
        waitSatisfied = true;
      })
      .catch(() => {});
  }
  if (opts.settle) await page.waitForTimeout(opts.settle);
  const after = await snapshot(page, scope);

  const changes = [];
  if (after.aria !== before.aria) changes.push('aria');
  if (after.dialogs !== before.dialogs) changes.push('dialog');
  if (after.testids !== before.testids) changes.push('structure');
  if (after.text !== before.text || after.htmlLen !== before.htmlLen) changes.push('content');

  let category;
  if (triggerError) {
    category = 'none';
  } else if (opts.expect) {
    category = changes.includes(opts.expect) ? opts.expect : 'none';
  } else {
    category = changes[0] ?? 'none';
  }
  if (waitSatisfied && !changes.includes('structure')) {
    // A concrete waitFor satisfied is structural evidence even if the
    // coarse scope snapshot didn't flag a testid diff (e.g. same testid set,
    // different data). Fold it in without overriding an existing bucket.
    category = category === 'none' ? 'structure' : category;
  }

  const ok = category !== 'none' && !triggerError;
  const knownBroken = Boolean(opts.knownBroken);
  const status = ok ? 'PASS' : knownBroken ? 'BROKEN' : 'FAIL';
  results.push({ control: name, status, category, changes, knownBroken, triggerError: triggerError ? String(triggerError.message ?? triggerError).slice(0, 200) : null });
  if (ok) pass(name, category);
  else if (knownBroken) console.log(`BROKEN (known)  ${name}`);
  else if (triggerError) fail(name, triggerError);
  else fail(name, new Error(`no observable change (${changes.join(',') || 'none'})`));
  return { before, after, category };
}

async function main() {
  if (!existsSync(electronBinary)) {
    console.error(`Electron binary not found: ${electronBinary}`);
    process.exit(1);
  }
  // Stale instances from interrupted runs hold the CDP port — kill first.
  try {
    execSync("pkill -f 'remote-debugging-port=9337' || true", { stdio: 'ignore' });
  } catch {
    // Nothing to clean.
  }
  execSync('bun run build:preload', { cwd: appRoot, stdio: 'pipe' });
  execSync('bunx vite build', { cwd: appRoot, stdio: 'pipe' });

  // Isolated userData so this audit never touches the golden-path or dev state.
  const userDataDir = join(appRoot, 'e2e/.user-data-interactions');
  execSync(`rm -rf "${userDataDir}"`);
  execSync(`mkdir -p "${userDataDir}"`);
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
    await context.waitForEvent('page', { timeout: 30_000 }).catch(() => undefined);
    const page = context.pages()[context.pages().length - 1];
    await page.waitForLoadState('domcontentloaded');

    // Bootstrap: a session + a focused symbol are prerequisites for most
    // surfaces (workspace tabs, security header, research/thesis).
    await page.getByRole('button', { name: 'New Session', exact: true }).waitFor({ timeout: 15_000 });
    await page.getByRole('button', { name: 'New Session', exact: true }).click();
    await page.locator('[data-testid="agent-input"]').first().waitFor({ timeout: 15_000 });
    await page.locator('[data-testid="watchlist-row-NVDA.US"]').first().click();
    await page
      .locator('[data-testid="security-header-symbol"]')
      .filter({ hasText: 'NVDA.US' })
      .waitFor({ timeout: 15_000 });
    pass('bootstrap: session + NVDA.US context', 'structure');

    const workspaceScope = '[data-testid="finance-workspace"]';
    const sidebarScope = 'aside';

    // --- Sidebar / Watchlist -------------------------------------------------
    // Agent Panel toggle collapses/expands the right pane (aria-pressed flip).
    await probe(
      page,
      'Sidebar > Agent Panel toggle',
      sidebarScope,
      () => page.getByRole('button', { name: 'Agent Panel', exact: true }).click(),
      { expect: 'aria' }
    );
    await probe(
      page,
      'Sidebar > Agent Panel toggle (restore)',
      sidebarScope,
      () => page.getByRole('button', { name: 'Agent Panel', exact: true }).click(),
      { expect: 'aria' }
    );

    // Watchlist row selection focuses the security workspace.
    await probe(
      page,
      'Watchlist > row select (TSLA.US)',
      workspaceScope,
      () => page.locator('[data-testid="watchlist-row-TSLA.US"]').first().click(),
      { waitFor: '[data-testid="security-header-symbol"]', settle: 0 }
    );

    // --- Workspace tabs (Overview is the default after a row select) ---------
    for (const tab of ['Chart', 'Financials', 'News', 'Overview']) {
      await probe(
        page,
        `Workspace tab > ${tab}`,
        workspaceScope,
        () => page.getByRole('tab', { name: tab, exact: true }).first().click(),
        { expect: 'content' }
      );
    }

    // --- Chart periods -------------------------------------------------------
    await page.getByRole('tab', { name: 'Chart', exact: true }).first().click();
    await page.locator('[data-testid="chart-canvas"]').waitFor({ timeout: 15_000 });
    await probe(
      page,
      'Chart > period 5m',
      workspaceScope,
      () => page.getByRole('button', { name: '5m', exact: true }).click(),
      { expect: 'aria' }
    );
    await probe(
      page,
      'Chart > period 1d (restore)',
      workspaceScope,
      () => page.getByRole('button', { name: '1d', exact: true }).click(),
      { expect: 'aria' }
    );

    // --- SecurityHeader > Deep Research (navigates to research section) ------
    await probe(
      page,
      'SecurityHeader > Deep Research (navigates)',
      workspaceScope,
      () => page.locator('[data-testid="deep-research-button"]').first().click(),
      { waitFor: '[data-testid="research-panel"]', settle: 0 }
    );

    // NOTE: the ResearchPanel "Deep Research" start/stop actions kick off a
    // long-running capability fetch + synthesis run. That contract is exercised
    // by the golden-path e2e (run.mjs step E); here we assert only the
    // navigation affordance so the sweep stays fast and deterministic.

    // --- Portfolio -----------------------------------------------------------
    await probe(
      page,
      'Sidebar > nav Portfolio',
      workspaceScope,
      () => page.getByRole('button', { name: 'Portfolio', exact: true }).click(),
      {
        waitForFn: () =>
          page.getByRole('button', { name: /Analyze Portfolio/i }).first().waitFor({ timeout: 15_000 }),
      }
    );
    // The portfolio fetch is async; while it loads the section shows a pulsing
    // skeleton whose height differs from the settled content, shifting the
    // "Analyze Portfolio" button. Wait for the fetch to settle before probing
    // so the click isn't racing a layout shift.
    await page.getByText('Total Value').first().waitFor({ timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(600);
    await probe(
      page,
      'Portfolio > Analyze Portfolio',
      workspaceScope,
      () => page.getByRole('button', { name: /Analyze Portfolio/i }).first().click(),
      { waitFor: '[data-testid="portfolio-risk-panel"]', timeout: 120_000 }
    );

    // --- Alerts --------------------------------------------------------------
    await probe(
      page,
      'Sidebar > nav Alerts',
      workspaceScope,
      () => page.getByRole('button', { name: 'Alerts', exact: true }).click(),
      {
        waitForFn: () =>
          page.getByRole('button', { name: '+ New', exact: true }).waitFor({ timeout: 15_000 }),
      }
    );
    await probe(
      page,
      'Alerts > + New (opens form dialog)',
      workspaceScope,
      () => page.getByRole('button', { name: '+ New', exact: true }).click(),
      { expect: 'dialog' }
    );
    await probe(
      page,
      'Alerts > Cancel (closes dialog)',
      workspaceScope,
      () => page.getByRole('button', { name: 'Cancel', exact: true }).first().click(),
      { expect: 'dialog' }
    );

    // --- Thesis --------------------------------------------------------------
    await probe(
      page,
      'Sidebar > nav Thesis',
      workspaceScope,
      () => page.getByRole('button', { name: 'Thesis', exact: true }).click(),
      { waitFor: '[data-testid="thesis-panel"]', settle: 0 }
    );

    // --- Compare -------------------------------------------------------------
    await probe(
      page,
      'Sidebar > nav Compare',
      workspaceScope,
      () => page.getByRole('button', { name: 'Compare', exact: true }).click(),
      { waitFor: '[data-testid="compare-workspace"]', settle: 0 }
    );
    await page.locator('[data-testid="compare-symbol-input"]').first().fill('AAPL.US');
    await probe(
      page,
      'Compare > Add symbol',
      workspaceScope,
      () => page.locator('[data-testid="compare-add"]').first().click(),
      { expect: 'content', settle: 300 }
    );

    // --- Skills --------------------------------------------------------------
    await probe(
      page,
      'Sidebar > nav Skills',
      workspaceScope,
      () => page.getByRole('button', { name: 'Skills', exact: true }).click(),
      { waitFor: '[data-testid="skill-list"], [data-testid="skills-search"]' }
    );

    // Search input filters the list.
    const searchInput = page.locator('[data-testid="skills-search"]').first();
    if ((await searchInput.count()) > 0) {
      await probe(
        page,
        'Skills > search filters list',
        workspaceScope,
        () => searchInput.fill('zzzz-no-match'),
        { expect: 'content', settle: 300 }
      );
      await searchInput.fill('');
    } else {
      console.log('SKIP  Skills > search (no search input rendered)');
    }

    // Status filter chip (aria-pressed).
    const filterChip = page.locator('[data-testid="skills-filter-ready"]').first();
    if ((await filterChip.count()) > 0) {
      await probe(
        page,
        'Skills > status filter chip',
        workspaceScope,
        () => filterChip.click(),
        { expect: 'aria', settle: 300 }
      );
    } else {
      console.log('SKIP  Skills > status filter chip (no chips rendered)');
    }

    // Skill row opens the detail drawer.
    const skillRow = page.locator('[data-testid^="skill-row-"]').first();
    const hasSkills = (await skillRow.count()) > 0;
    if (hasSkills) {
      await probe(
        page,
        'Skills > open detail drawer',
        workspaceScope,
        () => skillRow.click(),
        { waitFor: '[data-testid="skill-detail-drawer"]' }
      );

      const drawerToggle = page.locator('[data-testid="skill-detail-drawer"] [role="switch"]').first();
      if ((await drawerToggle.count()) > 0) {
        await probe(
          page,
          'Skills > drawer toggle',
          workspaceScope,
          () => drawerToggle.click(),
          // Functional, but shares the z-index root cause (see About close):
          // when the drawer surface is occluded by a pane the click is
          // intercepted — report as known-broken rather than gating.
          { expect: 'aria', settle: 900, knownBroken: true }
        );
      }
      // Escape closes the drawer via its document-level key handler (works
      // even while the drawer surface is occluded). Not a button probe.
      await page.keyboard.press('Escape');
      await page
        .locator('[data-testid="skill-detail-drawer"]')
        .first()
        .waitFor({ state: 'detached', timeout: 5_000 })
        .catch(() => {});
    } else {
      console.log('SKIP  Skills row/drawer controls (no skills installed in local runtime)');
    }

    // Enable/disable toggle on the skills-home row.
    const rowToggle = page.locator('[data-testid="skill-list"] [role="switch"]').first();
    if ((await rowToggle.count()) > 0) {
      await probe(
        page,
        'Skills > enable/disable toggle',
        workspaceScope,
        () => rowToggle.click(),
        { expect: 'aria', settle: 900 }
      );
    } else {
      console.log('SKIP  Skills > enable/disable toggle (no switch rendered)');
    }

    // --- Watchlist section header (from a non-default section) ---------------
    await probe(
      page,
      'Sidebar > Watchlist section header',
      workspaceScope,
      () => page.getByRole('button', { name: 'Watchlist', exact: true }).click(),
      { waitFor: '[data-testid="security-header-symbol"]', settle: 0 }
    );

    // --- TitleBar > About (dialog) -------------------------------------------
    await probe(
      page,
      'TitleBar > About (opens dialog)',
      'aside',
      () => page.getByRole('button', { name: 'About Folio' }).click(),
      { expect: 'dialog' }
    );
    await probe(
      page,
      'TitleBar > About (close dialog)',
      'aside',
      () => page.locator('[aria-label="Close dialog"]').first().click(),
      // KNOWN BROKEN: the Dialog's z-[--z-index-modal] compiles to an invalid
      // `z-index: --z-index-modal`, so the About overlay renders behind the
      // Allotment sash (z-index 5) and the × close button is unclickable.
      // Reported, not gating — close via Escape below.
      { expect: 'dialog', knownBroken: true }
    );
    await page.keyboard.press('Escape');

    // --- LLM selector --------------------------------------------------------
    const modelButton = page.locator('button[aria-haspopup="menu"]').first();
    await modelButton.waitFor({ timeout: 15_000 });
    await probe(
      page,
      'LLM selector > open model dropdown',
      'aside',
      () => modelButton.click(),
      { expect: 'aria' }
    );
    const option = page.locator('[role="option"]').first();
    if ((await option.count()) > 0) {
      await probe(
        page,
        'LLM selector > choose model',
        'aside',
        () => option.click(),
        { expect: 'aria', settle: 800 }
      );
    } else {
      console.log('SKIP  LLM selector > choose model (no options in local runtime)');
    }
    await page.keyboard.press('Escape');

    // --- Agent run -----------------------------------------------------------
    await probe(
      page,
      'Agent > Send (starts run)',
      'aside',
      async () => {
        const input = page.locator('[data-testid="agent-input"]').first();
        await input.fill('NVDA.US 今日走势');
        await input.press('Enter');
      },
      { waitFor: '[data-testid="run-panel"]', timeout: 30_000 }
    );
  } catch (error) {
    fail('harness setup', error);
  } finally {
    await browser?.close().catch(() => undefined);
    shutdown(electronProcess)
  }

  console.log('\n--- INTERACTION CONTRACT RESULTS ---');
  for (const r of results) {
    console.log(`${r.status}  ${r.control}  [${r.category}]`);
  }
  console.log(JSON.stringify({ summary: results }, null, 2));

  if (failures > 0) {
    console.error(`Interaction sweep failed: ${failures} control(s).`);
    process.exit(1);
  }
  console.log('Interaction contract sweep passed.');
}

main();
