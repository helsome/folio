// Trusted release-only, job-local CLI installation. Never authenticate or persist credentials.
import { chmodSync, mkdirSync, mkdtempSync, appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { sha256 } from './release-lib.mjs';
import { longbridgeAssetFor } from './release-provider.mjs';
if (process.env.FOLIO_RELEASE_GATES !== '1' || !process.env.GITHUB_REF?.startsWith('refs/tags/v')) {
  throw new Error('Longbridge setup is restricted to trusted version-tag release gates');
}
const asset = longbridgeAssetFor(process.platform, process.arch);
const work = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'folio-cli-'));
const archive = join(work, asset.name);
const response = await fetch(`https://github.com/longbridge/longbridge-terminal/releases/download/v${asset.version}/${asset.name}`);
if (!response.ok) throw new Error(`Longbridge release download failed: HTTP ${response.status}`);
writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
if (sha256(archive) !== asset.sha256) throw new Error('Longbridge release SHA256 mismatch');
const binDir = join(work, 'bin'); mkdirSync(binDir);
const binary = process.platform === 'win32' ? 'longbridge.exe' : 'longbridge';
execFileSync('tar', ['-xf', archive, '-C', binDir, binary], { stdio: 'pipe' });
if (process.platform !== 'win32') chmodSync(join(binDir, binary), 0o755);
const version = execFileSync(join(binDir, binary), ['--version'], { encoding: 'utf8', stdio: 'pipe' }).trim();
if (version !== `longbridge ${asset.version}`) throw new Error('Unexpected Longbridge binary version');
if (!process.env.GITHUB_PATH) throw new Error('GITHUB_PATH is required');
appendFileSync(process.env.GITHUB_PATH, binDir + '\n');
console.log(`Installed verified Longbridge ${asset.version} for ${process.platform}/${process.arch}; no authentication performed.`);
