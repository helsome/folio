import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';
export const longbridgeKeys = ['LONGBRIDGE_APP_KEY', 'LONGBRIDGE_APP_SECRET', 'LONGBRIDGE_ACCESS_TOKEN'];
// Upstream v0.17.0 published release digests; no floating installer script is executed.
export function longbridgeAssetFor(platform, arch) {
  const assets = {
    'darwin-arm64': ['longbridge-terminal-darwin-arm64.tar.gz', '1c1af2ee4a22a76d20c667e8aa1a0083991a874b07b29f10c2cd4132a0647577'],
    'darwin-x64': ['longbridge-terminal-darwin-amd64.tar.gz', '853e0b4f7884877ab52b590b820f586802bd64205109247b23b752a50e1c1058'],
    'win32-x64': ['longbridge-terminal-windows-amd64.zip', 'fba79490a2bd2e034f34f24dd541864d6187d55c7321f35ca88595e803e7c719'],
  };
  const asset = assets[`${platform}-${arch}`];
  if (!asset) throw new Error('Unsupported Longbridge native target');
  return { version: '0.17.0', name: asset[0], sha256: asset[1] };
}
export function withoutReleaseSecrets(source) {
  const env = { ...source };
  for (const key of Object.keys(env)) {
    if (key === 'FINAGENT_ENV_FILE_CONTENT' || longbridgeKeys.includes(key) || /^(APPLE_|CSC_|WIN_CSC_)/.test(key)) delete env[key];
  }
  return env;
}
export function releaseProviderEnv(source) {
  let values;
  try { values = parseEnv(source.FINAGENT_ENV_FILE_CONTENT || ''); }
  catch { throw new Error('Could not parse existing FINAGENT_ENV_FILE_CONTENT (contents suppressed)'); }
  const selected = Object.fromEntries(longbridgeKeys.map((key) => [key, source[key] || values[key]]));
  const missing = longbridgeKeys.filter((key) => !selected[key]?.trim());
  if (missing.length) throw new Error(`Release blocked: existing FINAGENT_ENV_FILE_CONTENT must supply ${missing.join(', ')}. Reuse existing authorized credentials; no OAuth login or new credentials are created.`);
  if (source.FINAGENT_DEMO_DATA === '1' || values.FINAGENT_DEMO_DATA === '1') throw new Error('Release product gates must not use demo data');
  return { ...withoutReleaseSecrets(source), ...selected, FINAGENT_AGENT_PROVIDER: 'local', FINAGENT_DEMO_DATA: '0', RUST_LOG: 'error' };
}
export function checkReleaseProvider(env, execute = execFileSync) {
  // Capture all output: quote/account data and authentication diagnostics are never logged.
  let response;
  try {
    const version = execute('longbridge', ['--version'], { env, encoding: 'utf8', timeout: 10_000, stdio: 'pipe' });
    if (!/^longbridge 0\.17\.0\b/.test(version.trim())) throw new Error('Wrong CLI version');
    response = JSON.parse(execute('longbridge', ['quote', 'NVDA.US', '--format', 'json'], {
      env, encoding: 'utf8', timeout: 60_000, stdio: 'pipe', maxBuffer: 2 * 1024 * 1024,
    }));
  } catch { throw new Error('Release blocked: Longbridge v0.17.0 quote probe failed. Check existing credentials, read permissions and network; provider output suppressed.'); }
  const rows = Array.isArray(response) ? response : [response];
  if (!rows.some((row) => row?.symbol === 'NVDA.US' && ['last', 'last_done', 'last_price', 'lastPrice'].some((key) => Number(row[key]) > 0))) {
    throw new Error('Release blocked: Longbridge quote probe returned no usable NVDA quote (response suppressed)');
  }
}
