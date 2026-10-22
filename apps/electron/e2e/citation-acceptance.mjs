// Live, opt-in Copilot citation acceptance (#30): drives the REAL app
// (Electron renderer + main-process kernelHost + Pi runtime with a real
// model) through a mixed-source question — structured financial quote +
// news — and captures the full citation path:
//   S2 inline citation markers in the answer
//   S3 the message-level "Sources (n)" entry
//   S4 the SourceInspector open (grouped list)
//   S5 deep link: clicking an inline citation focuses its evidence detail
// Set EXPECT_CITATIONS=0 to capture the same scenario on main (Before shot).
//
// Env: ANTHROPIC_API_KEY (+ ANTHROPIC_BASE_URL / ANTHROPIC_MODEL /
// FINAGENT_PI_MODEL) for the real model; FINAGENT_DEMO_DATA=1 supplies the
// market/news transport (no Longbridge CLI in the acceptance environment —
// declared in the PR).
import { execSync, spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveElectronBinary } from './electron-harness.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..');
const repoRoot = join(here, '../../..');
const electronMain = join(appRoot, 'src/main/index.js');
const electronBinary = resolveElectronBinary(appRoot, repoRoot);
const cdpPort = 9352;
const cdpUrl = `http://127.0.0.1:${cdpPort}`;
const userDataDir = join(appRoot, 'e2e/.user-data-citation');
const outputDir = join(appRoot, 'e2e/artifacts/citation-acceptance');
const expectCitations = process.env.EXPECT_CITATIONS !== '0';
const localMode = process.env.ACCEPTANCE_PROVIDER === 'local';
const question = localMode
  ? 'What is the price of AAPL.US?'
  : 'What is Apple\'s latest stock price? Summarize the latest news about Apple too, and cite the sources.';

function waitForCdp(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setInterval(async () => {
      if (Date.now() > deadline) {
        clearInterval(timer);
        rejectPromise(new Error('Electron CDP endpoint did not come up in time.'));
        return;
      }
      try {
        const response = await fetch(`${cdpUrl}/json/version`);
        if (response.ok) { clearInterval(timer); resolvePromise(); }
      } catch { /* still starting */ }
    }, 300);
  });
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
  execSync('bun run build:main', { cwd: appRoot, stdio: 'pipe' });
  execSync('bun run build:preload', { cwd: appRoot, stdio: 'pipe' });
  execSync('bunx vite build', { cwd: appRoot, stdio: 'pipe' });
  rmSync(userDataDir, { recursive: true, force: true });
  mkdirSync(userDataDir, { recursive: true });
  // The Pi runtime exits 1 when --session-dir does not exist yet — pre-create it.
  mkdirSync(join(userDataDir, 'pi-sessions'), { recursive: true });
  execSync(`bun ${join(here, 'seed-locale.mjs')} ${userDataDir} en-US`, { stdio: 'pipe' });
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });

  const bunExe = 'C:\\Users\\lhy6\\AppData\\Roaming\\npm\\node_modules\\bun\\bin\\bun.exe';
  const piArgs = [
    'x', '@mariozechner/pi-coding-agent', '--mode', 'rpc', '--provider', 'anthropic',
    ...(process.env.ANTHROPIC_MODEL ? ['--model', process.env.ANTHROPIC_MODEL] : []),
    '--extension', join(repoRoot, '.pi/extensions/finagent/index.ts'),
  ].join(' ');
  const electronProcess = spawn(
    electronBinary,
    [electronMain, `--remote-debugging-port=${cdpPort}`, '--no-sandbox'],
    {
      cwd: repoRoot,
      stdio: 'ignore',
      env: {
        ...process.env,
        FINAGENT_AGENT_PROVIDER: localMode ? 'local' : 'pi-runtime',
        FINAGENT_DEMO_DATA: '1',
        FINAGENT_FORCE_PROD_LOAD: '1',
        FINAGENT_E2E: '1',
        FINAGENT_E2E_HIDDEN: '1',
        FINAGENT_USER_DATA_DIR: userDataDir,
        // GUI-launched Electron does not inherit the shell PATH where bunx
        // lives — point the runtime at the absolute bun executable.
        ...(localMode ? {} : { FINAGENT_PI_COMMAND: bunExe, FINAGENT_PI_ARGS: piArgs }),
      },
    }
  );

  let browser;
  try {
    await waitForCdp(90_000);
    browser = await chromium.connectOverCDP(cdpUrl, { timeout: 30_000 });
    const page = await waitForPage(browser.contexts()[0], 30_000);
    await page.waitForLoadState('domcontentloaded');
    // Mark onboarding completed through the preload IPC bridge, then reload so
    // the wizard never mounts (it is a multi-step modal that intercepts input).
    await page.evaluate(async () => {
      const bridge = window.electronAPI ?? window.finagent;
      if (bridge?.onboarding?.setCompleted) await bridge.onboarding.setCompleted({ completed: true });
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2_000);
    await page.getByRole('button', { name: /^(New Session|新建会话)$/ }).first().waitFor({ timeout: 30_000 });
    await page.getByRole('button', { name: /^(New Session|新建会话)$/ }).first().click();
    const input = page.locator('[data-testid="agent-input"]').first();
    await input.waitFor({ timeout: 20_000 });
    await page.setViewportSize({ width: 1440, height: 900 });

    await input.fill(question);
    await input.press('Enter');
    console.log('QUESTION sent:', question);

    // Readiness: inline citations (pi-runtime real-model path) or the Sources
    // entry (local deterministic path — typed blocks with evidence chips).
    let retries = 0;
    const waitDeadline = Date.now() + (localMode ? 120_000 : 420_000);
    let ready = false;
    let resent = false;
    while (Date.now() < waitDeadline) {
      const readySelector = localMode
        ? '[data-testid="open-source-inspector"]'
        : '[data-citation-id]';
      const appeared = await page.locator(readySelector).first()
        .waitFor({ timeout: 20_000 }).then(() => true).catch(() => false);
      if (appeared) { ready = true; break; }
      if (localMode) break; // local answers are immediate; no retry machinery
      const retryButton = page.getByRole('button', { name: /^(重试|Retry)$/ }).first();
      if ((await retryButton.count()) > 0 && (await retryButton.isVisible().catch(() => false)) && retries < 8) {
        retries += 1;
        console.log('Pi runtime failed — clicking retry, attempt', retries);
        if (retries === 2) {
          const diagButton = page.getByRole('button', { name: /^(打开诊断|Open diagnostics)$/ }).first();
          if ((await diagButton.count()) > 0) {
            await diagButton.click().catch(() => {});
            await page.waitForTimeout(1_500);
            const diagText = await page.locator('body').innerText().catch(() => '');
            writeFileSync(join(outputDir, 'pi-runtime-diagnostics.txt'), diagText, 'utf8');
            console.log('diagnostics captured');
            await page.keyboard.press('Escape').catch(() => {});
            await page.waitForTimeout(800);
          }
        }
        await retryButton.click().catch(() => {});
        await page.waitForTimeout(4_000);
        resent = true;
        await input.fill(question);
        await input.press('Enter');
        console.log('question re-sent after retry');
      }
    }
    if (!ready) {
      const panelText = await page.locator('[data-testid="agent-panel"]').first().innerText().catch(() => '<panel missing>');
      writeFileSync(join(outputDir, 'debug-panel-on-failure.txt'), panelText, 'utf8');
      await capture(join(outputDir, 'debug-panel-on-failure.png')).catch(() => {});
      throw new Error('Acceptance readiness signal never appeared (see debug-panel-on-failure)');
    }

    // Wait for the answer to settle: the panel text must stop changing.
    let lastText = '';
    const settleDeadline = Date.now() + (localMode ? 60_000 : 300_000);
    while (Date.now() < settleDeadline) {
      const text = await page.locator('[data-testid="agent-panel"]').first().innerText().catch(() => '');
      if (text.length > 0 && text === lastText) break;
      lastText = text;
      await page.waitForTimeout(4_000);
    }
    // Kill every animation loop so screenshots never hang on the pulse caret.
    await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
    await page.waitForTimeout(1_000);


    // Screenshot helper: page.screenshot can hang waiting for frame stability
    // when JS-driven repaints continue (streaming pulse, sash). Fall back to a
    // direct CDP capture, which snapshots immediately.
    let cdpSession;
    async function capture(path) {
      try {
        await page.screenshot({ path, animations: 'disabled', timeout: 8_000 });
        return 'page';
      } catch {
        cdpSession ??= await browser.contexts()[0].newCDPSession(page);
        const result = await cdpSession.send('Page.captureScreenshot', { format: 'png' });
        const { writeFileSync: wfs } = await import('node:fs');
        wfs(path, Buffer.from(result.data, 'base64'));
        return 'cdp';
      }
    }

    const answerText = await page.locator('[data-testid="agent-panel"]').first().innerText();
    writeFileSync(join(outputDir, 'answer-panel.txt'), answerText, 'utf8');
    const citationCount = await page.locator('[data-citation-id]').count();
    const evidenceChipCount = await page.locator('[data-evidence-id]').count();
    console.log('CITATION chips rendered:', citationCount, '| evidence chips:', evidenceChipCount);
    const sourcesButton = page.locator('[data-testid="open-source-inspector"]').first();

    if (localMode) {
      // Deterministic local-provider path: typed blocks with numbered evidence
      // chips + the message-level Sources entry + the SourceInspector.
      await capture(join(outputDir, 'S2-block-evidence-chips.png'));
      await sourcesButton.waitFor({ timeout: 15_000 });
      await sourcesButton.click();
      await page.locator('[data-testid="source-inspector"]').waitFor({ timeout: 15_000 });
      await page.waitForTimeout(800);
      await capture(join(outputDir, 'S4-source-inspector.png'));
      const inspectorText = await page.locator('[data-testid="source-inspector"]').innerText();
      writeFileSync(join(outputDir, 'S4-inspector-text.txt'), inspectorText, 'utf8');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(600);
      // Deep link: clicking an evidence chip focuses its detail.
      const chip = page.locator('[data-evidence-id]').first();
      await chip.scrollIntoViewIfNeeded().catch(() => {});
      await chip.click().catch(() => {});
      await page.locator('[data-testid="source-inspector"]').waitFor({ timeout: 15_000 });
      await page.waitForTimeout(800);
      await capture(join(outputDir, 'S5-inspector-from-chip.png'));
      const focused = await page.locator('[data-testid="source-details"]').first().innerText().catch(() => '');
      writeFileSync(join(outputDir, 'S5-focused-source.txt'), focused, 'utf8');
    } else {
      // Real-model path: inline citation superscripts deep-linking the inspector.
      await capture(join(outputDir, 'S2-inline-citations.png'));
      await page.locator('[data-citation-id][data-citation-resolved="true"]').first().click();
      await page.locator('[data-testid="source-inspector"]').waitFor({ timeout: 15_000 });
      await page.waitForTimeout(800);
      await capture(join(outputDir, 'S5-inspector-from-citation.png'));
      const focusedSource = await page.locator('[data-testid="source-details"]').first().innerText().catch(() => '');
      writeFileSync(join(outputDir, 'S5-focused-source.txt'), focusedSource, 'utf8');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      await sourcesButton.waitFor({ timeout: 15_000 });
      await sourcesButton.scrollIntoViewIfNeeded().catch(() => {});
      await capture(join(outputDir, 'S3-sources-entry.png'));
      await sourcesButton.click();
      await page.locator('[data-testid="source-inspector"]').waitFor({ timeout: 15_000 });
      await page.waitForTimeout(800);
      await capture(join(outputDir, 'S4-source-inspector.png'));
      const inspectorText = await page.locator('[data-testid="source-inspector"]').innerText();
      writeFileSync(join(outputDir, 'S4-inspector-text.txt'), inspectorText, 'utf8');
    }

    console.log('ACCEPTANCE CAPTURE COMPLETE');
  } finally {
    if (browser) await browser.close().catch(() => {});
    try { if (electronProcess.exitCode === null) electronProcess.kill(); } catch { /* already gone */ }
  }
}

main().then(
  () => process.exit(0),
  (error) => { console.error('ACCEPTANCE FAILED:', error.message); process.exit(1); }
);
