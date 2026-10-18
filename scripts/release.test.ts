import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installerName, stageManifest, targets, targetFor, validateVersion, verifyRelease } from './release-lib.mjs';
import { ensurePortFree, spawnApp, stopApp } from '../apps/electron/e2e/platform.mjs';
import { createServer } from 'node:net';
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const version = '0.4.0-beta.3';
const sha = 'a'.repeat(40);
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'folio-release-test-')); dirs.push(dir);
  for (const target of targets) {
    writeFileSync(join(dir, installerName(version, target)), `fake-installer-${target.platform}-${target.arch}`);
    const manifest = stageManifest(dir, version, target, sha);
    writeFileSync(join(dir, `verified-${target.platform}-${target.arch}.json`), JSON.stringify({
      buildSha: sha, platform: target.platform, arch: target.arch, installerSha256: manifest.sha256,
      installerSmoke: 'passed', freshInstall: 'passed', goldenPath: 'passed', v5: 'passed',
    }));
  }
  return dir;
}
describe('release gates', () => {
  it('rejects tag/version mismatch and unsupported native targets', () => {
    expect(validateVersion(version, version, `v${version}`)).toBe(version);
    expect(() => validateVersion(version, '0.4.0-beta.2')).toThrow();
    expect(() => validateVersion(version, version, 'v0.4.0-beta.2')).toThrow();
    expect(() => targetFor('linux', 'x64')).toThrow();
    expect(() => targetFor('win32', 'arm64')).toThrow();
    expect(targetFor('darwin', 'arm64').ext).toBe('dmg');
  });
  it('requires all three installers and produces a combined SHA256 manifest', () => {
    const dir = fixture();
    expect(verifyRelease(dir, version, sha)).toHaveLength(3);
    expect(readFileSync(join(dir, 'SHA256SUMS.txt'), 'utf8').trim().split('\n')).toHaveLength(3);
    rmSync(join(dir, installerName(version, targets[2])));
    expect(() => verifyRelease(dir, version, sha)).toThrow();
  });
  it('rejects stale or unexpected installers', () => {
    const dir = fixture(); writeFileSync(join(dir, 'Folio-old.dmg'), 'stale');
    expect(() => verifyRelease(dir, version, sha)).toThrow();
  });
  it('rejects checksum tampering and a different build commit', () => {
    const dir = fixture();
    expect(() => verifyRelease(dir, version, 'b'.repeat(40))).toThrow();
    writeFileSync(join(dir, installerName(version, targets[0])), 'tampered');
    expect(() => verifyRelease(dir, version, sha)).toThrow();
  });
  it('rejects missing or non-release native smoke evidence', () => {
    const dir = fixture(); const file = join(dir, 'verified-win32-x64.json');
    const evidence = JSON.parse(readFileSync(file, 'utf8')); evidence.goldenPath = 'not-run';
    writeFileSync(file, JSON.stringify(evidence));
    expect(() => verifyRelease(dir, version, sha)).toThrow('Missing native validation');
    rmSync(file);
    expect(() => verifyRelease(dir, version, sha)).toThrow();
  });
  it('rejects false signing/notarization claims', () => {
    const dir = fixture(); const file = join(dir, 'manifest-darwin-arm64.json');
    const manifest = JSON.parse(readFileSync(file, 'utf8')); manifest.notarized = true;
    writeFileSync(file, JSON.stringify(manifest));
    expect(() => verifyRelease(dir, version, sha)).toThrow('Invalid manifest');
  });
  it('refuses to attach the smoke harness to a stale CDP port', async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as {port:number};
    try { await expect(ensurePortFree(address.port)).rejects.toThrow(); }
    finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
    await ensurePortFree(address.port);
  });
  it('waits for its own app child to exit before relaunch', async () => {
    const child = spawnApp(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    await stopApp(child);
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  });
});
