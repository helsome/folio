// Built Electron renderer + real preload/IPC, with controlled portfolio responses.
// Run after `bun run --cwd apps/electron build`.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { resolveElectronBinary } from './electron-harness.mjs';
import { seedLocale } from './seed-locale.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..');
const repoRoot = join(here, '../../..');
const artifacts = join(here, 'artifacts', 'portfolio-failure');
mkdirSync(artifacts, { recursive: true });
const userDataDir = mkdtempSync(join(here, '.user-data-portfolio-failure-'));
seedLocale(userDataDir, 'zh-CN');

const app = await electron.launch({
  executablePath: resolveElectronBinary(appRoot, repoRoot),
  args: [join(appRoot, 'src/main/index.js'), '--disable-gpu'],
  cwd: repoRoot,
  env: {
    ...process.env,
    FINAGENT_FORCE_PROD_LOAD: '1',
    FINAGENT_AGENT_PROVIDER: 'local',
    FINAGENT_DEMO_DATA: '1',
    FINAGENT_E2E: '1',
    FINAGENT_E2E_HIDDEN: '1',
    FINAGENT_E2E_VISIBLE: '0',
    FINAGENT_USER_DATA_DIR: userDataDir,
  },
});

async function screenshot(page, name) {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  // Native capture also works when the test window stays hidden.
  const png = await app.evaluate(async ({ BrowserWindow }) => {
    const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage(
      undefined, { stayHidden: true, stayAwake: true },
    );
    return image.toPNG().toString('base64');
  });
  writeFileSync(join(artifacts, `${name}.png`), Buffer.from(png, 'base64'));
}

try {
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
  });
  await page.waitForFunction(() => Boolean(window.electronAPI?.onboarding));
  await page.evaluate(() => window.electronAPI.onboarding.setCompleted({ completed: true }));
  const cases = [
    ['parse-error', 'PARSE_FAILURE', '无法读取投资组合数据'],
    ['timeout', 'TIMEOUT', '长桥响应超时。'],
    ['provider-error', 'PROVIDER_ERROR', 'fixture diagnostic'],
  ];

  for (const [name, code, expected] of cases) {
    await app.evaluate(({ ipcMain }, response) => {
      ipcMain.removeHandler('market:getPortfolio');
      ipcMain.handle('market:getPortfolio', () => response);
    }, { ok: false, error: { code, message: code === 'PROVIDER_ERROR' ? 'fixture diagnostic' : 'raw vendor {{{' } });
    await page.reload();
    await page.getByRole('button', { name: '投资组合', exact: true }).click();
    await page.getByText(expected, { exact: true }).waitFor();
    assert.equal(await page.locator('[data-testid="portfolio-view"]').count(), 0);
    assert.equal((await page.locator('body').innerText()).includes('raw vendor {{{'), false);
    await screenshot(page, name);
    console.log(`PASS ${name}: real IPC response reaches the classified failure view`);
  }

  for (const [name, code] of [
    ['not-connected-demo', 'LONGBRIDGE_NOT_INSTALLED'],
    ['no-permission-demo', 'AUTH_EXPIRED'],
  ]) {
    await app.evaluate(({ ipcMain }, code) => {
      ipcMain.removeHandler('market:getPortfolio');
      ipcMain.handle('market:getPortfolio', () => ({
        ok: false, error: { code, message: 'fixture connection failure' },
      }));
    }, code);
    await page.reload();
    await page.getByRole('button', { name: '投资组合', exact: true }).click();
    await page.locator('[data-testid="portfolio-view"] [data-testid="demo-badge"]').waitFor();
    await screenshot(page, name);
    console.log(`PASS ${name}: sample holdings remain explicitly badged`);
  }

  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('market:getPortfolio');
    ipcMain.handle('market:getPortfolio', () => ({ ok: false, error: { code: 'TIMEOUT', message: '' } }));
    ipcMain.removeHandler('portfolio:listManual');
    ipcMain.handle('portfolio:listManual', () => ({ ok: true, data: [
      { id: 'local', name: 'Offline account', currency: 'USD', updatedAt: 1,
        holdings: [{ symbol: 'MANUAL.US', name: 'Manual holding', quantity: 2 }] },
    ] }));
  });
  await page.reload();
  await page.getByRole('button', { name: '投资组合', exact: true }).click();
  await page.getByText('长桥响应超时。', { exact: true }).waitFor();
  for (const value of ['manual:local', '', 'manual:local', '']) {
    await page.getByRole('combobox').selectOption(value);
    if (value) await page.getByText('MANUAL.US', { exact: true }).waitFor();
    else await page.getByText('长桥响应超时。', { exact: true }).waitFor();
  }
  await page.getByRole('button', { name: '导入…', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await screenshot(page, 'manual-import-on-failure');
  console.log('PASS manual access: account switching and import survive broker failure');
  console.log(`Screenshots: ${artifacts}`);
} finally {
  await app.close();
}
