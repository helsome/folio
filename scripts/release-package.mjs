#!/usr/bin/env node
// Native internal builds with opt-in, verified Apple Developer ID signing. Publishing is ALWAYS disabled here.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { appleKeys, appleSigningEnabled, verifyMacSigning } from './mac-signing.mjs';
import { installerName, stageManifest, targetFor, validateVersion } from './release-lib.mjs';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(root, 'apps/electron');
const target = targetFor(process.platform, process.arch);
const pkg = JSON.parse(readFileSync(join(app, 'package.json')));
const version = validateVersion(JSON.parse(readFileSync(join(root, 'package.json'))).version, pkg.version, process.env.RELEASE_TAG);
const buildSha = process.env.FINAGENT_BUILD_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
if (!/^[a-f0-9]{40}$/.test(buildSha)) throw new Error('Expected full commit SHA');
const output = join(root, 'dist/electron');
const staging = join(root, 'dist/release');
// Never collect stale outputs from another version/architecture or failed run.
for (const dir of [output, staging]) rmSync(dir, { recursive: true, force: true });
const signing = appleSigningEnabled(target.platform, process.env);
const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
// Build steps never receive signing credentials, even on trusted release runs.
for (const key of Object.keys(env)) if (/^(CSC_|WIN_CSC_|APPLE_)/.test(key) && key !== 'CSC_IDENTITY_AUTO_DISCOVERY') delete env[key];
function run(args, cwd = root) { execFileSync('bun', args, { cwd, env, stdio: 'inherit' }); }
run(['run', 'build']);
run(['run', 'build:extension'], app);
const require = createRequire(join(app, 'package.json'));
const builder = require.resolve('electron-builder/cli.js');
const builderEnv = { ...env, DEBUG: '' };
const signingArgs = [];
if (signing) {
  for (const key of appleKeys) builderEnv[key] = process.env[key];
  builderEnv.CSC_LINK = process.env.APPLE_CERTIFICATE_BASE64;
  builderEnv.CSC_KEY_PASSWORD = process.env.APPLE_CERT_PASSWORD;
  builderEnv.CSC_IDENTITY_AUTO_DISCOVERY = 'true';
  signingArgs.push('--config.mac.identity=', '--config.forceCodeSigning=true', '--config.mac.notarize=true', '--config.mac.hardenedRuntime=true');
} else if (target.platform === 'darwin' && target.arch === 'arm64') {
  // Apple Silicon requires an ad-hoc code signature; this is not a publisher identity.
  signingArgs.push('--config.mac.identity=-');
}
execFileSync('node', [builder, target.platform === 'darwin' ? '--mac' : '--win', target.platform === 'darwin' ? 'dmg' : 'nsis', `--${target.arch}`, '--publish', 'never',
  `--config.extraMetadata.folio.buildSha=${buildSha}`, '--config.extraMetadata.folio.channel=internal', ...signingArgs], { cwd: app, env: builderEnv, stdio: 'inherit' });
const expected = installerName(version, target);
const installers = readdirSync(output).filter((n) => /\.(dmg|exe)$/.test(n));
if (installers.length !== 1 || installers[0] !== expected) throw new Error(`Expected only ${expected}; got ${installers.join(', ')}`);
mkdirSync(staging, { recursive: true });
copyFileSync(join(output, expected), join(staging, expected));
const security = signing ? verifyMacSigning(join(output, target.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Folio.app'), process.env.APPLE_TEAM_ID) : { signing: 'unsigned', notarized: false };
stageManifest(staging, version, target, buildSha, security);
console.log(`Staged ${expected}: ${security.signing}, notarized=${security.notarized}, internal preview.`);
