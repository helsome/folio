#!/usr/bin/env node
// Mount/install the actual distributable, inspect it, and test that installed copy.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyMacSigning } from './mac-signing.mjs';
import { releaseProviderEnv, withoutReleaseSecrets, checkReleaseProvider } from './release-provider.mjs';
import { copyMacApp, installerName, sha256, targetFor } from './release-lib.mjs';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = join(root, 'apps/electron');
const target = targetFor(process.platform, process.arch);
const pkg = JSON.parse(readFileSync(join(appRoot, 'package.json')));
const staging = join(root, 'dist/release');
const installer = join(staging, installerName(pkg.version, target));
const manifest = JSON.parse(readFileSync(join(staging, `manifest-${target.platform}-${target.arch}.json`)));
if (sha256(installer) !== manifest.sha256) throw new Error('Installer checksum mismatch');
const work = mkdtempSync(join(tmpdir(), 'folio-install-'));
const installDir = join(work, 'installed');
let binary, resources;
let signatureVerification = 'not-applicable';
let notarizationVerification = 'not-applicable';
function run(command, args, options = {}) {
  return execFileSync(command, args, { stdio: 'inherit', cwd: tmpdir(), timeout: 600_000, ...options });
}
try {
  if (process.platform === 'darwin') {
    // Verify DMG integrity before mounting; do not alter Gatekeeper/quarantine settings.
    run('hdiutil', ['verify', installer]);
    const mount = join(work, 'mount');
    run('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, installer]);
    try { copyMacApp(join(mount, 'Folio.app'), join(installDir, 'Folio.app')); }
    finally { run('hdiutil', ['detach', mount]); }
    if (manifest.signing === 'developer-id') {
      verifyMacSigning(join(installDir, 'Folio.app'));
      signatureVerification = 'passed'; notarizationVerification = 'passed';
    }
    binary = join(installDir, 'Folio.app/Contents/MacOS/Folio');
    resources = join(installDir, 'Folio.app/Contents/Resources');
    const arch = execFileSync('lipo', ['-archs', binary], { encoding: 'utf8' }).trim();
    if (arch !== (target.arch === 'x64' ? 'x86_64' : 'arm64')) throw new Error(`Wrong Mach-O architecture: ${arch}`);
  } else {
    // /D must be the LAST NSIS argument. Silent per-user installation, not extraction.
    run(installer, ['/S', '/currentuser', `/D=${installDir}`]);
    binary = join(installDir, 'Folio.exe');
    resources = join(installDir, 'resources');
    const pe = readFileSync(binary);
    const header = pe.readUInt32LE(0x3c);
    if (pe.toString('ascii', header, header + 4) !== 'PE\0\0' || pe.readUInt16LE(header + 4) !== 0x8664) {
      throw new Error('Installed executable is not Windows x64 PE');
    }
  }
  const require = createRequire(join(appRoot, 'package.json'));
  const builderRequire = createRequire(require.resolve('electron-builder'));
  const libRequire = createRequire(builderRequire.resolve('app-builder-lib'));
  const asar = libRequire('@electron/asar');
  const archive = join(resources, 'app.asar');
  const packedPkg = JSON.parse(asar.extractFile(archive, 'package.json').toString());
  if (packedPkg.version !== pkg.version || packedPkg.folio?.buildSha !== manifest.buildSha || packedPkg.folio?.channel !== 'internal') {
    throw new Error('Installed version/build/channel mismatch');
  }
  for (const file of ['src/main/index.js', 'src/preload/index.cjs', 'dist/renderer/index.html']) {
    if (asar.extractFile(archive, file).length === 0) throw new Error(`Empty packaged resource: ${file}`);
  }
  const entries = asar.listPackage(archive);
  if (!entries.some((name) => /dist\/renderer\/assets\/.*\.js$/.test(name))) throw new Error('Missing renderer assets');
  if (entries.some((name) => /(?:^|\/)\.env(?:\.|$)/.test(name))) throw new Error('Environment file in app bundle');
  for (const name of ['finagent', 'langsmith']) {
    if (!existsSync(join(resources, 'extensions', name, 'index.js'))) throw new Error(`Missing ${name} extension`);
  }
  const skillCount = readdirSync(join(resources, 'skills'), { recursive: true }).filter((name) => /SKILL\.md$/.test(name)).length;
  if (skillCount < 10) throw new Error('Missing packaged skills');
  console.log(`Installed resources/architecture verified: ${target.platform}/${target.arch}, ${skillCount} skills`);
  const env = { ...withoutReleaseSecrets(process.env), FOLIO_PACKAGED_BINARY: binary, FINAGENT_AGENT_PROVIDER: 'local' };
  const releaseGates = process.env.FOLIO_RELEASE_GATES === '1';
  for (const harness of ['package-smoke', 'fresh-install']) {
    run('node', [join(appRoot, 'e2e', `${harness}.mjs`)], { env });
  }
  if (releaseGates) {
    const liveEnv = { ...releaseProviderEnv(process.env), FOLIO_PACKAGED_BINARY: binary };
    checkReleaseProvider(liveEnv);
    for (const harness of ['run', 'v5']) run('node', [join(appRoot, 'e2e', `${harness}.mjs`)], { env: liveEnv });
  }
  writeFileSync(join(staging, `verified-${target.platform}-${target.arch}.json`), JSON.stringify({
    platform: target.platform, arch: target.arch, buildSha: manifest.buildSha, installerSha256: manifest.sha256,
    signatureVerification, notarizationVerification,
    installerSmoke: 'passed', freshInstall: 'passed', goldenPath: releaseGates ? 'passed' : 'not-run', v5: releaseGates ? 'passed' : 'not-run', skillCount,
  }, null, 2) + '\n');
} finally {
  // Runners are ephemeral; no signing material or persistent installation is retained.
  if (process.platform === 'win32' && existsSync(join(installDir, 'Uninstall Folio.exe'))) {
    run(join(installDir, 'Uninstall Folio.exe'), ['/S']);
  }
  rmSync(work, { recursive: true, force: true });
}
