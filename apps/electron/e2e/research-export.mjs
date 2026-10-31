import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { resolveElectronBinary } from './electron-harness.mjs';
import { seedLocale } from './seed-locale.mjs';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(appRoot, '../..');
const artifacts = join(appRoot, 'e2e/artifacts');
await mkdir(artifacts, { recursive: true });
const output = await mkdtemp(join(artifacts, 'research-export-'));
const userData = join(output, 'user-data');
const report = JSON.parse(await readFile(join(repoRoot,
  'docs/acceptance/research-recovery/final-report.json'), 'utf8'));
const checkpoint = JSON.parse(await readFile(join(repoRoot,
  'docs/acceptance/research-recovery/after-checkpoint.json'), 'utf8'));
assert.equal(checkpoint.summary.reportId, report.id);

// 将公开验收记录恢复到独立 profile；通过真实主进程读取，不替换 IPC。
await mkdir(join(userData, 'store/research/reports'), { recursive: true });
seedLocale(userData, 'en-US');
await writeFile(join(userData, 'store/research/reports', `${report.id}.json`), JSON.stringify(report));
await writeFile(join(userData, 'store/research/index.json'), JSON.stringify({ reports: [{
  id: report.id, symbol: report.symbol, generatedAt: report.generatedAt,
  stance: report.stance, confidence: report.confidence,
}] }));
await writeFile(join(userData, 'store/research/runs.json'), JSON.stringify({ runs: [checkpoint.summary] }));

const application = await electron.launch({
  executablePath: resolveElectronBinary(appRoot, repoRoot),
  acceptDownloads: true,
  args: [join(appRoot, 'src/main/index.js'), '--no-sandbox', '--disable-gpu'],
  cwd: repoRoot,
  env: { ...process.env, FINAGENT_FORCE_PROD_LOAD: '1', FINAGENT_E2E_HIDDEN: '1',
    FINAGENT_USER_DATA_DIR: userData, FINAGENT_DEMO_DATA: '0' },
});

try {
  const page = await application.firstWindow();
  await page.waitForFunction(() => Boolean(window.electronAPI?.export?.json));
  const exported = await page.evaluate((reportId) => window.electronAPI.export.json({ reportId }), report.id);
  assert.equal(exported.ok, true, JSON.stringify(exported.error));
  const archive = JSON.parse(exported.data);
  assert.equal(archive.schemaVersion, 'folio-research-archive/v1');
  assert.deepEqual(archive.report, report);
  assert.ok(archive.evidence.claims.length > 0);
  const evidenceIds = new Set(archive.evidence.evidence.map((item) => item.evidenceId));
  const sourceIds = new Set(archive.evidence.sources.map((source) => source.sourceId));
  for (const claim of archive.evidence.claims) {
    for (const id of claim.evidenceIds) assert.ok(evidenceIds.has(id));
  }
  for (const item of archive.evidence.evidence) assert.ok(sourceIds.has(item.sourceId));

  const missing = await page.evaluate(() => window.electronAPI.export.json({ reportId: 'missing-report' }));
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'REPORT_NOT_FOUND');
  const invalid = await page.evaluate(() => window.electronAPI.export.json({ reportId: '../credentials' }));
  assert.equal(invalid.ok, false);

  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Research', exact: true }).first().click();
  await page.getByTestId('research-report').waitFor();
  await page.getByTestId('export-menu-trigger').click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-download-json').click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), 'NVDA.US-research.json');
  const file = join(output, download.suggestedFilename());
  await download.saveAs(file);
  assert.equal(await readFile(file, 'utf8'), exported.data);
  assert.equal(await page.getByTestId('export-menu-error').count(), 0);

  await page.reload();
  await page.waitForFunction(() => Boolean(window.electronAPI?.export?.json));
  const afterReload = await page.evaluate((reportId) => window.electronAPI.export.json({ reportId }), report.id);
  assert.equal(afterReload.ok, true);
  assert.equal(afterReload.data, exported.data);
  await writeFile(join(output, 'verification.json'), JSON.stringify({
    source: 'recorded DeepSeek / Longbridge research-recovery acceptance',
    reportId: report.id, status: report.runStatus,
    reportPreserved: true, referencesResolved: true,
    missingReportRejected: true, invalidIdRejected: true,
    menuDownloadMatchesIpc: true, reloadStable: true,
  }, null, 2));
  console.log(`PASS: real Electron IPC, menu download, reload; recorded report ${report.id}`);
  console.log(`Artifacts: ${output}`);
} finally {
  await application.close();
}
