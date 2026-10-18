import { createHash } from 'node:crypto';
import { cpSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const targets = [
  { platform: 'darwin', arch: 'arm64', ext: 'dmg' },
  { platform: 'darwin', arch: 'x64', ext: 'dmg' },
  { platform: 'win32', arch: 'x64', ext: 'exe' },
];
export function targetFor(platform, arch) {
  const target = targets.find((t) => t.platform === platform && t.arch === arch);
  if (!target) throw new Error(`Unsupported native target: ${platform}/${arch}`);
  return target;
}
export function validateVersion(rootVersion, appVersion, tag) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(rootVersion) || rootVersion !== appVersion) {
    throw new Error('Root and Electron package versions must be equal SemVer versions');
  }
  if (tag && tag !== `v${rootVersion}`) throw new Error(`Tag must equal v${rootVersion}`);
  return rootVersion;
}
export function installerName(version, target) {
  return `Folio-${version}-${target.platform === 'darwin' ? 'mac' : 'win'}-${target.arch}.${target.ext}`;
}
export function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
export function stageManifest(dir, version, target, buildSha) {
  const name = installerName(version, target);
  if (!statSync(join(dir, name)).isFile() || statSync(join(dir, name)).size === 0) throw new Error('Missing/empty installer');
  const manifest = { version, buildSha, platform: target.platform, arch: target.arch, signing: 'unsigned', notarized: false,
    installer: name, sha256: sha256(join(dir, name)) };
  writeFileSync(join(dir, `manifest-${target.platform}-${target.arch}.json`), JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(join(dir, `SHA256SUMS-${target.platform}-${target.arch}.txt`), `${manifest.sha256}  ${name}\n`);
  return manifest;
}
export function verifyRelease(dir, version, buildSha) {
  const expected = targets.map((t) => installerName(version, t)).sort();
  const actual = readdirSync(dir).filter((n) => /\.(dmg|exe)$/.test(n)).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Release must contain exactly two DMGs and one EXE for the expected version/architectures');
  const manifests = targets.map((t) => {
    const m = JSON.parse(readFileSync(join(dir, `manifest-${t.platform}-${t.arch}.json`), 'utf8'));
    const name = installerName(version, t);
    if (m.version !== version || m.buildSha !== buildSha || m.platform !== t.platform || m.arch !== t.arch ||
        m.installer !== name || m.signing !== 'unsigned' || m.notarized !== false || m.sha256 !== sha256(join(dir, name))) {
      throw new Error(`Invalid manifest/checksum: ${name}`);
    }
    const evidence = JSON.parse(readFileSync(join(dir, `verified-${t.platform}-${t.arch}.json`), 'utf8'));
    if (evidence.buildSha !== buildSha || evidence.installerSha256 !== m.sha256 || evidence.arch !== t.arch ||
        evidence.platform !== t.platform || evidence.installerSmoke !== 'passed' || evidence.freshInstall !== 'passed' ||
        evidence.goldenPath !== 'passed' || evidence.v5 !== 'passed') throw new Error(`Missing native validation: ${name}`);
    return m;
  });
  writeFileSync(join(dir, 'SHA256SUMS.txt'), manifests.map((m) => `${m.sha256}  ${m.installer}`).join('\n') + '\n');
  return manifests;
}

export function copyMacApp(source, destination) {
  // Preserve framework links exactly so they remain valid after detaching the DMG.
  cpSync(source, destination, { recursive: true, dereference: false, verbatimSymlinks: true });
}
