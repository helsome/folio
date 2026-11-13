import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { _electron } from 'playwright-core';
import { resolveElectronBinary } from './electron-harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(process.env.FOLIO_SELECTION_APP_ROOT ?? join(here, '..'));
const repoRoot = resolve(appRoot, '../..');
const output = resolve(process.env.FOLIO_SELECTION_OUTPUT ?? join(here, 'artifacts/research-selection'));
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(output, 'profile-'));
const oldA = fixtureReport('a-old', 'AAPL.US', Date.UTC(2026, 9, 17, 12), 'neutral');
const newA = fixtureReport('a-new', 'AAPL.US', Date.UTC(2026, 9, 18, 12), 'bullish');
const onlyB = fixtureReport('b-only', 'MSFT.US', Date.UTC(2026, 9, 19, 12), 'bearish');
const reports = [onlyB, newA, oldA];
const checks = [];
let electronApp;
let page;

function fixtureReport(id, symbol, generatedAt, stance) {
  return { id, symbol, generatedAt, summary: `Fixture only: ${id} conclusion. No live provider or model used.`,
    stance, confidence: 0.6, sections: [], bullCase: ['Fixture demand case'], bearCase: ['Fixture valuation case'],
    catalysts: [], risks: ['Fixture only'], capabilityRuns: [], runStatus: 'completed' };
}
async function json(file, value) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2));
}
await json(join(profile, 'app-preferences.json'), { locale: 'en-US' });
await json(join(profile, 'onboarding.json'), { completed: true });
await json(join(profile, 'automations.json'), [{ id: 'offline-fixture', type: 'watchlist-daily-review', enabled: false, createdAt: 0 }]);
await json(join(profile, 'store/research/index.json'), { reports: reports.map(({ id, symbol, generatedAt, stance, confidence }) => ({ id, symbol, generatedAt, stance, confidence })) });
await json(join(profile, 'store/research/runs.json'), { runs: reports.map((r) => ({
  id: 'run-' + r.id, symbol: r.symbol, reportId: r.id, status: 'completed', startedAt: r.generatedAt,
  finishedAt: r.generatedAt, plannedCapabilities: [], completedCapabilities: [], failedCapabilities: [],
})) });
for (const report of reports) await json(join(profile, 'store/research/reports', report.id + '.json'), report);

const bootstrap = join(output, 'fixture-bootstrap.mjs');
await writeFile(bootstrap, `
import { app, ipcMain, session } from 'electron';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
globalThis.__selectionFixture = { requests: [], blockedNetwork: 0, blockedCommands: 0, commandDetails: [] };
const state = globalThis.__selectionFixture;
const deny = (command) => { state.blockedCommands++; state.commandDetails.push({ executable: String(command).split(/\\s+/)[0], stack: new Error().stack }); throw new Error('Fixture: external commands disabled'); };
for (const method of ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork']) cp[method] = deny;
syncBuiltinESMExports();
globalThis.fetch = async () => { state.blockedNetwork++; throw new Error('Fixture: external network disabled'); };
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => handle(channel, async (event, input, ...rest) => {
  if (channel === 'research:start' && state.holdStart) {
    state.requests.push({ channel, input });
    return new Promise((resolve) => { state.resolveStart = resolve; });
  }
  if (/^(market:|longbridge:|connections:|portfolioRisk:|llm:|pulse:|automation:buildBrief)/.test(channel) ||
      /^(runs:start|research:start|research:resume|research:restart|thesis:reEvaluate|automation:run)/.test(channel)) {
    return { ok: false, error: { code: 'FIXTURE_OFFLINE', message: 'Offline report-selection fixture' } };
  }
  if (/^(research:|thesis:)/.test(channel)) state.requests.push({ channel, input });
  return listener(event, input, ...rest);
});
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => {
    state.blockedNetwork++; callback({ cancel: true });
  });
});
await import(${JSON.stringify(pathToFileURL(join(appRoot, 'src/main/index.js')).href)});
`);

async function launch() {
  const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'DISPLAY', 'XDG_RUNTIME_DIR', 'SYSTEMROOT'].filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
  electronApp = await _electron.launch({
    executablePath: resolveElectronBinary(appRoot, repoRoot), args: [bootstrap, '--disable-gpu'],
    cwd: repoRoot, env: { ...env, FINAGENT_USER_DATA_DIR: profile, FINAGENT_ENV_FILE: join(profile, 'absent.env'),
      FINAGENT_AGENT_PROVIDER: 'local', FINAGENT_FORCE_PROD_LOAD: '1', FINAGENT_E2E_HIDDEN: '1' },
    timeout: 30_000,
  });
  page = await electronApp.firstWindow();
  page.setDefaultTimeout(10_000);
  await page.waitForFunction(() => Boolean(window.electronAPI?.research));
  page.on('pageerror', (error) => console.error('Renderer:', error.message));
}
async function screenshot(name) { await page.screenshot({ path: join(output, name + '.png'), fullPage: true }); }
async function reportIs(report) {
  const view = page.getByTestId('research-report');
  await view.waitFor();
  await page.waitForFunction((summary) => document.querySelector('[data-testid="research-report"]')?.textContent?.includes(summary), report.summary);
  const text = await view.textContent();
  assert.ok(text.includes(report.summary));
  assert.ok(text.includes(await page.evaluate((value) => new Date(value).toLocaleString(), report.generatedAt)));
}
async function openTodayReport(report) {
  const row = page.locator('li').filter({ hasText: report.summary });
  await row.getByRole('button').click();
  await page.getByTestId('research-report').waitFor();
}
async function today() { await page.getByTestId('sidebar').getByRole('button', { name: 'Today', exact: true }).click(); }

try {
  await launch();
  await page.evaluate(() => {
    localStorage.setItem('folio.onboarding.completed.v1', '1');
    localStorage.setItem('folio.onboarding.disclaimersAccepted.v1', '1');
    localStorage.setItem('folio.prefs.navSection', JSON.stringify('today'));
    localStorage.setItem('folio.prefs.agentPanelVisible', 'false');
  });
  await page.reload();
  await page.getByTestId('today-continue-AAPL.US').first().waitFor();
  await screenshot('today');
  await openTodayReport(oldA);
  await page.locator('.folio-pilot-verdict').scrollIntoViewIfNeeded();
  await screenshot('today-old-report');
  await reportIs(oldA);
  await page.getByTestId('what-changed-unavailable').waitFor();
  await page.getByTestId('research-history').scrollIntoViewIfNeeded();
  await screenshot('history');
  checks.push('Today opens A old content and original date; no predecessor is explicit');
  console.log('PASS', checks.at(-1));

  assert.equal(await page.getByTestId('research-history').getByRole('button').count(), 2);
  await page.getByTestId('research-history').locator('[data-report-id="a-new"]').click();
  await reportIs(newA);
  await page.getByTestId('what-changed').waitFor();
  const diff = await page.evaluate(() => window.electronAPI.research.getDiff({ symbol: 'AAPL.US', reportId: 'a-new' }));
  assert.equal(diff.ok, true);
  assert.equal(diff.data.currentReportId, newA.id);
  assert.equal(diff.data.previousReportId, oldA.id);
  await page.locator('.folio-pilot-verdict').scrollIntoViewIfNeeded();
  await screenshot('selected-diff');
  checks.push('History stays reachable; A new What Changed compares A old → A new');
  console.log('PASS', checks.at(-1));

  await page.getByTestId('research-history').locator('[data-report-id="a-old"]').click();
  await reportIs(oldA);
  await page.getByTestId('research-next-action').getByRole('button', { name: 'Save as Investment Thesis', exact: true }).click();
  await page.getByTestId('thesis-saved-banner').waitFor();
  const saved = await page.evaluate(() => window.electronAPI.thesis.list('AAPL.US'));
  assert.equal(saved.ok, true);
  const thesis = saved.data.find((item) => item.sourceReportId === 'a-old');
  assert.ok(thesis);
  assert.equal(thesis.summary, oldA.summary);
  const persisted = JSON.parse(await readFile(join(profile, 'thesis', thesis.id + '.json'), 'utf8'));
  assert.equal(persisted.sourceReportId, oldA.id);
  await page.locator('.folio-pilot-verdict').scrollIntoViewIfNeeded();
  await screenshot('old-thesis-saved');
  checks.push('Real preload → IPC → kernel → converter → disk saves old sourceReportId');
  console.log('PASS', checks.at(-1));

  await today();
  await openTodayReport(onlyB);
  await reportIs(onlyB);
  assert.equal(await page.getByTestId('research-history').getByRole('button').count(), 1);
  assert.ok(!(await page.getByTestId('research-panel').textContent()).includes(oldA.summary));
  await page.locator('.folio-pilot-verdict').scrollIntoViewIfNeeded();
  await screenshot('security-b');
  checks.push('Switching to B shows its only report and one history entry');
  console.log('PASS', checks.at(-1));

  await today();
  await openTodayReport(oldA);
  await reportIs(oldA);
  await electronApp.evaluate(() => { globalThis.__selectionFixture.holdStart = true; });
  const search = page.locator('.folio-research-command-search input');
  await search.fill(onlyB.symbol);
  await search.press('Enter');
  await page.locator('.folio-pilot-research-header').getByRole('button', { name: 'Starting…', exact: true }).waitFor();
  await page.getByTestId('research-history').getByRole('button').waitFor();
  assert.equal(await page.getByTestId('research-report').count(), 0);
  await screenshot('start-pending-existing-history');
  await electronApp.evaluate(() => {
    const fixture = globalThis.__selectionFixture;
    const finish = fixture.resolveStart;
    delete fixture.resolveStart;
    fixture.holdStart = false;
    finish({ ok: false, error: { code: 'FIXTURE_START_FAILED', message: 'Offline start failure fixture' } });
  });
  await reportIs(onlyB);
  await page.getByRole('alert').filter({ hasText: 'Deep Research is not available yet.' }).waitFor();
  await screenshot('start-failure-existing-history');
  checks.push('Real keyboard search into B keeps pending state and displays its fixture start failure with existing history');
  await today();
  await openTodayReport(oldA);
  await reportIs(oldA);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('folio.prefs.researchSelection'))), { symbol: oldA.symbol, reportId: oldA.id });
  const beforeRestart = await electronApp.evaluate(() => globalThis.__selectionFixture);
  await electronApp.close(); electronApp = undefined;
  await launch();
  await reportIs(oldA);
  await page.getByTestId('what-changed-unavailable').waitFor();
  const reopened = await page.evaluate(() => window.electronAPI.thesis.list('AAPL.US'));
  assert.equal(reopened.data.find((item) => item.id === thesis.id)?.sourceReportId, oldA.id);
  await page.locator('.folio-pilot-verdict').scrollIntoViewIfNeeded();
  await screenshot('restart-old-report');
  checks.push('A old selection, original date and thesis source survive a real Electron process restart');
  const afterRestart = await electronApp.evaluate(() => globalThis.__selectionFixture);
  await json(join(output, 'boundary-attempts.json'), { beforeRestart, afterRestart });
  assert.equal(beforeRestart.blockedCommands + afterRestart.blockedCommands, 0);
  assert.equal(beforeRestart.blockedNetwork + afterRestart.blockedNetwork, 0);
  const verification = { mode: 'fixture', checks, profile, providerOrModelValidation: false,
    blockedCommands: 0, blockedNetwork: 0, requests: [...beforeRestart.requests, ...afterRestart.requests] };
  await json(join(output, 'verification.json'), verification);
  console.log(JSON.stringify({ passed: checks.length, checks, output }, null, 2));
} catch (error) {
  if (page && !page.isClosed()) await screenshot('failure').catch(() => {});
  await json(join(output, 'failure.json'), { checks, error: String(error), profile });
  throw error;
} finally { await electronApp?.close(); }
