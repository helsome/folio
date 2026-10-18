import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
export function developmentBinary() { return require('electron'); }
export function packagedBinary(root) {
  const candidate = process.env.FOLIO_PACKAGED_BINARY || (process.platform === 'win32'
    ? join(root, 'dist/electron/win-unpacked/Folio.exe')
    : join(root, `dist/electron/${process.arch === 'arm64' ? 'mac-arm64' : 'mac'}/Folio.app/Contents/MacOS/Folio`));
  if (!isAbsolute(candidate) || !existsSync(candidate)) throw new Error(`Packaged binary missing: ${candidate}`);
  return candidate;
}
export async function ensurePortFree(port) {
  // Never attach to a stale process and falsely validate a previous build.
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
export function spawnApp(binary, args, options) {
  const child = spawn(binary, args, options);
  child.on('error', (error) => console.error(`App launch failed: ${error.message}`));
  return child;
}
export async function stopApp(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    const code = await new Promise((resolve, reject) => { killer.once('error', reject); killer.once('exit', resolve); });
    if (code !== 0 && child.exitCode === null && child.signalCode === null) throw new Error('Could not stop app process tree');
  } else child.kill();
  await Promise.race([exited, new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('App did not exit')), 10_000);
    timer.unref();
  })]);
}
export async function completeOnboarding(page) {
  const overlay = page.locator('[data-testid="onboarding-overlay"]');
  if (await overlay.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false)) {
    await page.locator('[data-testid="disclaimer-accept"]').click();
    await page.locator('[data-testid="onboarding-continue"]').click();
    await page.locator('[data-testid="onboarding-skip"]').click();
    await overlay.waitFor({ state: 'detached', timeout: 15_000 });
  }
}
