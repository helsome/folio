import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const directory = fileURLToPath(new URL('.', import.meta.url));
const output = resolve(directory, 'artifacts/heatmap');
const url = process.env.HEATMAP_URL ?? `http://127.0.0.1:5174/@fs/${resolve(directory, 'heatmap.html').replaceAll('\\', '/')}`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.HEATMAP_BROWSER ?? 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  const started = performance.now();
  await page.goto(url);
  await page.getByTestId('heatmap-tile-AAPL').waitFor();
  assert.equal(await page.locator('[data-testid^="heatmap-tile-"]').count(), 6);
  const relativeArea = () => page.evaluate(() => {
    const apple = document.querySelector('[data-testid="heatmap-tile-AAPL"]').getBoundingClientRect();
    const nvidia = document.querySelector('[data-testid="heatmap-tile-NVDA"]').getBoundingClientRect();
    return apple.width * apple.height / (nvidia.width * nvidia.height);
  });
  assert.ok(Math.abs(await relativeArea() - 1) < 0.04, 'Equal mode gives equal tile area');
  const renderMs = performance.now() - started;
  await page.screenshot({ path: resolve(output, 'heatmap-equal.png'), fullPage: true });

  await page.getByLabel('Tile size').selectOption('weight');
  assert.ok(Math.abs(await relativeArea() - 1.2) < 0.08, 'Weighted area follows snapshot values');
  assert.ok((await page.getByTestId('heatmap-tile-AAPL').getAttribute('title')).includes('30%'));
  await page.screenshot({ path: resolve(output, 'heatmap-weighted.png'), fullPage: true });
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  assert.equal(await page.getByTestId('heatmap-table').locator('tbody tr').count(), 6);
  await page.getByTestId('heatmap-table').getByRole('button', { name: /Apple Inc/ }).click();
  assert.ok((await page.getByTestId('heatmap-detail').textContent()).includes('30%'));
  await page.getByRole('button', { name: 'Refresh heatmap', exact: true }).click();
  await page.getByTestId('heatmap-detail').getByText(/Apple Inc/).waitFor();
  await page.screenshot({ path: resolve(output, 'heatmap-table.png'), fullPage: true });

  await page.getByRole('button', { name: 'Heatmap', exact: true }).click();
  await page.getByTestId('heatmap-tile-NVDA').focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Back to heatmap', exact: true }).waitFor();
  assert.ok((await page.textContent('body')).includes('NVDA.US'));
  await page.screenshot({ path: resolve(output, 'heatmap-research.png'), fullPage: true });

  await page.getByRole('button', { name: 'Back to heatmap', exact: true }).click();
  await page.getByTestId('heatmap-tile-AAPL').click();
  await page.getByRole('button', { name: 'Back to heatmap', exact: true }).waitFor();
  assert.ok((await page.textContent('body')).includes('AAPL.US'));
  await page.getByRole('button', { name: 'Back to heatmap', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('heatmap-tile-AAPL').waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  assert.equal(overflow, false, 'Mobile page must not overflow horizontally');
  await page.screenshot({ path: resolve(output, 'heatmap-mobile.png'), fullPage: true });

  await page.setViewportSize({ width: 1280, height: 900 });
  const benchmarkStarted = performance.now();
  await page.goto(`${url}?count=100`);
  await page.getByTestId('heatmap-tile-FIX99').waitFor();
  const fixture100NavigationToTilesMs = Math.round(performance.now() - benchmarkStarted);
  const rectangles = await page.locator('[data-testid^="heatmap-tile-"]').evaluateAll((tiles) => tiles.map((tile) => {
    const box = tile.getBoundingClientRect();
    const map = tile.parentElement.getBoundingClientRect();
    return { width: box.width, height: box.height, inside: box.x >= map.x - 1 && box.y >= map.y - 1 && box.right <= map.right + 1 && box.bottom <= map.bottom + 1 };
  }));
  assert.equal(rectangles.length, 100);
  assert.ok(rectangles.every((box) => box.width > 0 && box.height > 0 && box.inside));
  assert.deepEqual(errors, [], 'No browser runtime errors');
  const report = {
    environment: `Node ${process.version} / ${process.platform} / ${await browser.version()}`,
    data: 'Fixture prices and positions; six real canonical catalog securities. No live provider/model.',
    tests: ['six real catalog securities', 'equal and weighted modes', 'correct ratio percentages', 'table from same snapshot', 'refresh preserves selection', 'keyboard Enter to actual ResearchPanel', 'mouse click to actual ResearchPanel', '390px responsive layout', '100 fixture DOM tiles with positive sizes inside map', 'no browser runtime errors'],
    pass: 10, fail: 0, coldNavigationToFirstTileMs: Math.round(renderMs), fixture100NavigationToTilesMs,
  };
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
