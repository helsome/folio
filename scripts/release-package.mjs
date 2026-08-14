#!/usr/bin/env node
// Folio release packaging (spec §38).
//
//   bun run release:package
//
// Builds the full app (renderer + preload + main + extension), packages it
// with electron-builder (mac: `dir` for internal runs + `dmg` for release,
// unsigned `identity=null`), then stages the DMG(s) and a `shasum -a 256`
// checksum manifest under `dist/release/`.
//
// Signing/notarization are opt-in via environment (CI injects Apple secrets):
//   APPLE_CERTIFICATE_BASE64        -> CSC_LINK (p12, base64)
//   APPLE_CERT_PASSWORD             -> CSC_KEY_PASSWORD
//   APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID -> notarization
// When the certificate secrets are absent the app is built unsigned. Secrets
// are never logged or echoed; electron-builder consumes them from the process
// environment only.

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const electronRoot = join(repoRoot, 'apps', 'electron');
const electronDist = join(repoRoot, 'dist', 'electron');
const releaseDir = join(repoRoot, 'dist', 'release');

function run(command, args, cwd, env) {
  const label = `${command} ${args.join(' ')}`;
  console.log(`\n> ${label}`);
  execFileSync(command, args, {
    cwd,
    env: env ?? process.env,
    stdio: 'inherit',
  });
}

// 1. Canonical build: packages + renderer + preload + main.
run('bun', ['run', 'build'], repoRoot);

// 2. Bundle the Pi extension (shipped via extraResources).
run('bun', ['run', 'build:extension'], electronRoot);

// 3. Package with electron-builder (dir + dmg). Sign only when a certificate is
//    provided; otherwise `identity=null` (from package.json) keeps it unsigned.
const signingEnabled = Boolean(
  process.env.APPLE_CERTIFICATE_BASE64 && process.env.APPLE_CERT_PASSWORD
);

const builderArgs = [];
const builderEnv = { ...process.env };
if (signingEnabled) {
  // Override `identity=null` so electron-builder auto-discovers the Developer ID
  // certificate imported from CSC_LINK.
  builderArgs.push('--config.mac.identity=');
  builderEnv.CSC_LINK = process.env.APPLE_CERTIFICATE_BASE64;
  builderEnv.CSC_KEY_PASSWORD = process.env.APPLE_CERT_PASSWORD;
  builderEnv.CSC_IDENTITY_AUTO_DISCOVERY = 'true';
}

// Bake the exact git SHA + channel into the packed package.json (folio.buildSha
// / folio.channel) so the About view reports real values at runtime without a
// build-time env var. CI injects both; local builds keep the source values.
if (process.env.FINAGENT_BUILD_SHA) {
  builderArgs.push(`--config.extraMetadata.folio.buildSha=${process.env.FINAGENT_BUILD_SHA}`);
}
if (process.env.FINAGENT_CHANNEL) {
  builderArgs.push(`--config.extraMetadata.folio.channel=${process.env.FINAGENT_CHANNEL}`);
}

run('bun', ['run', 'package:builder', ...builderArgs], electronRoot, builderEnv);

// 4. Stage DMG(s) + SHA256SUMS.txt under dist/release/.
mkdirSync(releaseDir, { recursive: true });

const dmgs = readdirSync(electronDist).filter((name) => name.endsWith('.dmg'));
if (dmgs.length === 0) {
  console.error('\nrelease:package FAILED — electron-builder produced no .dmg under dist/electron/.');
  process.exit(1);
}

for (const dmg of dmgs) {
  copyFileSync(join(electronDist, dmg), join(releaseDir, dmg));
}

// `shasum -a 256` output format (bare filenames, two-space separator) so the
// manifest is verifiable with `shasum -c SHA256SUMS.txt` from dist/release/.
const shasum = execFileSync('shasum', ['-a', '256', ...dmgs], {
  cwd: releaseDir,
  encoding: 'utf8',
});
writeFileSync(join(releaseDir, 'SHA256SUMS.txt'), shasum);

console.log(`\nrelease:package OK — ${dmgs.join(', ')} staged in ${releaseDir}`);
console.log(`Signing: ${signingEnabled ? 'enabled' : 'disabled (unsigned)'}`);
console.log('Checksums:\n' + shasum);
