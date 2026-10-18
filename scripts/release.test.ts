import { windowsSelfSignature } from './windows-signing.mjs';
import { appleSigningEnabled, verifyMacSigning, verifyMacAdhoc, appleKeys } from './mac-signing.mjs';
import { releaseProviderEnv, withoutReleaseSecrets, checkReleaseProvider, longbridgeAssetFor } from './release-provider.mjs';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readlinkSync, symlinkSync } from 'node:fs';
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
    const security = target.platform === 'darwin' ? { signing: 'ad-hoc', notarized: false } : { signing: 'self-signed', notarized: false, certificateSha256: 'c'.repeat(64) };
    const manifest = stageManifest(dir, version, target, sha, security);
    writeFileSync(join(dir, `verified-${target.platform}-${target.arch}.json`), JSON.stringify({
      buildSha: sha, platform: target.platform, arch: target.arch, installerSha256: manifest.sha256,
      installerSmoke: 'passed', freshInstall: 'passed', goldenPath: 'passed', v5: 'passed', signatureVerification: 'passed',
      publisherTrust: 'not-trusted', ...(target.platform === 'win32' ? { certificateSha256: security.certificateSha256 } : {}),
    }));
  }
  return dir;
}
describe('release gates', () => {
  it('preserves framework relative symlinks after the DMG source is removed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'folio-framework-test-')); dirs.push(dir);
    const source = join(dir, 'mount', 'Folio.app');
    const installed = join(dir, 'installed', 'Folio.app');
    const frameworkPath = 'Contents/Frameworks/Electron Framework.framework';
    const framework = join(source, frameworkPath);
    mkdirSync(join(framework, 'Versions', 'A'), { recursive: true });
    writeFileSync(join(framework, 'Versions', 'A', 'Electron Framework'), 'framework-binary');
    symlinkSync('A', join(framework, 'Versions', 'Current'), 'dir');
    symlinkSync('Versions/Current/Electron Framework', join(framework, 'Electron Framework'), 'file');
    // The real installer verifier runs under Node, so test Node's cp semantics too.
    const moduleUrl = new URL('./release-lib.mjs', import.meta.url).href;
    execFileSync('node', ['--input-type=module', '-e',
      `import { copyMacApp } from ${JSON.stringify(moduleUrl)}; copyMacApp(process.argv[1], process.argv[2]);`,
      source, installed]);
    rmSync(join(dir, 'mount'), { recursive: true });
    const copied = join(installed, frameworkPath);
    expect(readlinkSync(join(copied, 'Versions', 'Current'))).toBe('A');
    expect(readlinkSync(join(copied, 'Electron Framework'))).toBe('Versions/Current/Electron Framework');
    expect(readFileSync(join(copied, 'Electron Framework'), 'utf8')).toBe('framework-binary');
  });
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

describe('trusted release prerequisites', () => {
  const content = 'LONGBRIDGE_APP_KEY=fake-app-key\nLONGBRIDGE_APP_SECRET="fake-app-secret"\nLONGBRIDGE_ACCESS_TOKEN=fake-access-token\nNODE_OPTIONS=malicious\nANTHROPIC_API_KEY=unrelated';
  it('reuses only supported Longbridge fields without persisting the secret file', () => {
    const env = releaseProviderEnv({ FINAGENT_ENV_FILE_CONTENT: content, APPLE_CERT_PASSWORD: 'unrelated-signing-secret', PATH: '/test/bin' });
    expect(env.LONGBRIDGE_APP_KEY).toBe('fake-app-key');
    expect(env.LONGBRIDGE_APP_SECRET).toBe('fake-app-secret');
    expect(env.LONGBRIDGE_ACCESS_TOKEN).toBe('fake-access-token');
    expect(env.FINAGENT_ENV_FILE_CONTENT).toBeUndefined();
    expect(env.APPLE_CERT_PASSWORD).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.PATH).toBe('/test/bin');
    expect(withoutReleaseSecrets({ LONGBRIDGE_ACCESS_TOKEN: 'private', PATH: '/bin' })).toEqual({ PATH: '/bin' });
  });
  it('reports missing field names without revealing existing values', () => {
    let message = '';
    try { releaseProviderEnv({ FINAGENT_ENV_FILE_CONTENT: 'LONGBRIDGE_APP_KEY=private-fixture' }); }
    catch (error) { message = String(error); }
    expect(message).toContain('LONGBRIDGE_APP_SECRET');
    expect(message).toContain('LONGBRIDGE_ACCESS_TOKEN');
    expect(message).not.toContain('private-fixture');
  });
  it('rejects attempts to replace real release gates with demo data', () => {
    expect(() => releaseProviderEnv({ FINAGENT_ENV_FILE_CONTENT: content, FINAGENT_DEMO_DATA: '1' })).toThrow('demo data');
    expect(() => releaseProviderEnv({ FINAGENT_ENV_FILE_CONTENT: content + '\nFINAGENT_DEMO_DATA=1' })).toThrow('demo data');
  });
  it('probes the locked CLI with a read-only quote, without OAuth login', () => {
    const calls: string[][] = [];
    checkReleaseProvider({}, (_command: string, args: string[]) => {
      calls.push(args);
      return args[0] === '--version' ? 'longbridge 0.17.0\n' : '[{"symbol":"NVDA.US","last":"120.5"}]';
    });
    expect(calls).toEqual([['--version'], ['quote', 'NVDA.US', '--format', 'json']]);
    expect(longbridgeAssetFor('darwin', 'arm64').sha256).toHaveLength(64);
    expect(() => longbridgeAssetFor('linux', 'x64')).toThrow();
  });
  it('fails closed on unusable quotes and suppresses provider diagnostics', () => {
    expect(() => checkReleaseProvider({}, (_command: string, args: string[]) => args[0] === '--version' ? 'longbridge 0.17.0' : '[]')).toThrow('no usable');
    let message = '';
    try { checkReleaseProvider({}, () => { throw new Error('private-provider-fixture'); }); }
    catch (error) { message = String(error); }
    expect(message).toContain('Release blocked');
    expect(message).not.toContain('private-provider-fixture');
  });
});
describe('verified optional Apple signing', () => {
  const configured = Object.fromEntries(appleKeys.map((key) => [key, 'fake-fixture']));
  const requirement = 'designated => identifier "com.finagent.app" and anchor apple generic and certificate leaf[field.1.2.840.113635.100.6.1.13] /* exists */ and certificate leaf[subject.OU] = TEAMFIXTURE';
  const identity = 'Identifier=com.finagent.app\nAuthority=Developer ID Application: Fixture (TEAMFIXTURE)\nTeamIdentifier=TEAMFIXTURE\n';
  function signatureOutput(_command: string, args: string[]) {
    if (args.includes('--requirements')) return requirement;
    if (args.includes('--verbose=4')) return identity;
    return '';
  }

  it('requires explicit opt-in and a complete existing Apple configuration', () => {
    expect(appleSigningEnabled('darwin', configured)).toBe(false);
    expect(appleSigningEnabled('win32', { ...configured, FOLIO_ALLOW_APPLE_SIGNING: '1' })).toBe(false);
    expect(appleSigningEnabled('darwin', { FOLIO_ALLOW_APPLE_SIGNING: '1' })).toBe(false);
    expect(appleSigningEnabled('darwin', { ...configured, FOLIO_ALLOW_APPLE_SIGNING: '1' })).toBe(true);
    expect(() => appleSigningEnabled('darwin', { APPLE_ID: 'fake-fixture', FOLIO_ALLOW_APPLE_SIGNING: '1' })).toThrow('Incomplete');
  });
  it('requires code validation, Developer ID/team identity, staple and Gatekeeper acceptance', () => {
    const calls: string[] = [];
    const result = verifyMacSigning('/fake/Folio.app', 'TEAMFIXTURE', (command: string, args: string[]) => {
      calls.push(command + ' ' + args.join(' '));
      return signatureOutput(command, args);
    });
    expect(result).toEqual({ signing: 'developer-id', notarized: true });
    expect(calls).toHaveLength(5);
    expect(calls[3]).toBe('xcrun stapler validate /fake/Folio.app');
    expect(calls[4]).toBe('spctl --assess --type execute /fake/Folio.app');
  });
  it('rejects ad-hoc signatures, mismatched teams and missing notarization', () => {
    expect(() => verifyMacSigning('/fake', 'TEAMFIXTURE', () => 'adhoc')).toThrow('Developer ID');
    expect(() => verifyMacSigning('/fake', 'OTHERTEAM', signatureOutput)).toThrow('Developer ID');
    expect(() => verifyMacSigning('/fake', 'TEAMFIXTURE', (command: string, args: string[]) => {
      if (command === 'xcrun') throw new Error('private-signing-fixture');
      return signatureOutput(command, args);
    })).toThrow('tool output suppressed');
  });
  it('rejects a Team ID that only matches the configured prefix', () => {
    const otherRequirement = requirement.replace('TEAMFIXTURE', 'TEAMFIXTURE2');
    for (const quote of [false, true]) {
      const changedRequirement = quote ? otherRequirement.replace('= TEAMFIXTURE2', '= "TEAMFIXTURE2"') : otherRequirement;
      expect(() => verifyMacSigning('/fake', 'TEAMFIXTURE', (command: string, args: string[]) => {
        if (args.includes('--requirements')) return changedRequirement;
        if (args.includes('--verbose=4')) return identity.replaceAll('TEAMFIXTURE', 'TEAMFIXTURE2');
        return '';
      })).toThrow('Developer ID');
    }
  });
  it('rejects missing, duplicate or conflicting identity fields', () => {
    for (const details of [identity.replace('TeamIdentifier=TEAMFIXTURE', ''),
      identity + 'TeamIdentifier=TEAMFIXTURE2\n', identity.replace('com.finagent.app', 'com.other.app'),
      identity.replace('TeamIdentifier=TEAMFIXTURE', 'TeamIdentifier=TEAMFIXTURE2')]) {
      expect(() => verifyMacSigning('/fake', undefined, (command: string, args: string[]) =>
        args.includes('--verbose=4') ? details : signatureOutput(command, args))).toThrow('Developer ID');
    }
    expect(verifyMacSigning('/fake', 'TEAMFIXTURE', (command: string, args: string[]) =>
      args.includes('--requirements') ? requirement.replace('= TEAMFIXTURE', '= "TEAMFIXTURE"') : signatureOutput(command, args)))
      .toEqual({ signing: 'developer-id', notarized: true });
  });
  it('requires installed verification evidence for a signed manifest and rejects signed Windows claims', () => {
    const dir = fixture();
    const file = join(dir, 'manifest-darwin-arm64.json');
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    manifest.signing = 'developer-id'; manifest.notarized = true;
    writeFileSync(file, JSON.stringify(manifest));
    expect(() => verifyRelease(dir, version, sha)).toThrow('Missing native validation');
    const verified = join(dir, 'verified-darwin-arm64.json');
    const evidence = JSON.parse(readFileSync(verified, 'utf8'));
    evidence.signatureVerification = 'passed'; evidence.notarizationVerification = 'passed';
    writeFileSync(verified, JSON.stringify(evidence));
    expect(verifyRelease(dir, version, sha)).toHaveLength(3);
    expect(() => stageManifest(dir, version, targets[2], sha, { signing: 'developer-id', notarized: true })).toThrow('Invalid signing');
  });
});

describe('untrusted preview signing', () => {
  it('verifies ad-hoc code integrity without claiming Developer ID or notarization', () => {
    const calls: string[] = [];
    const verified = verifyMacAdhoc('/fake/Folio.app', (command: string, args: string[]) => {
      calls.push(command + ' ' + args.join(' '));
      return args.includes('--display') ? 'Identifier=com.finagent.app\nSignature=adhoc\nTeamIdentifier=not set\n' : '';
    });
    expect(verified).toEqual({ signing: 'ad-hoc', notarized: false });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('--verify --deep --strict');
  });
  it('rejects corrupt ad-hoc output and false publisher identities', () => {
    expect(() => verifyMacAdhoc('/fake', () => { throw new Error('private-diagnostic'); })).toThrow('output suppressed');
    expect(() => verifyMacAdhoc('/fake', () => 'Identifier=com.finagent.app\nSignature=adhoc\nTeamIdentifier=DEVELOPER')).toThrow('Expected ad-hoc');
  });
  const report = { signing: 'self-signed', notarized: false, certificateSha256: 'c'.repeat(64),
    integrity: 'passed', publisherTrust: 'not-trusted', privateKeyPersisted: false, tamperRejected: true };
  it('requires Windows cryptographic integrity, untrusted-publisher and ephemeral-key evidence', () => {
    const calls: string[][] = [];
    expect(windowsSelfSignature('sign', '/fake/installer.exe', undefined, (_command: string, args: string[]) => {
      calls.push(args); return JSON.stringify(report);
    })).toEqual(report);
    expect(calls[0]).not.toContain('-ExecutionPolicy');
    for (const changed of [{ integrity: 'failed' }, { publisherTrust: 'trusted' }, { privateKeyPersisted: true }, { tamperRejected: false }]) {
      expect(() => windowsSelfSignature('sign', '/fake', undefined, () => JSON.stringify({ ...report, ...changed }))).toThrow('required');
    }
  });
  it('rejects a different Windows signer and suppresses native failure diagnostics', () => {
    expect(() => windowsSelfSignature('verify', '/fake', 'b'.repeat(64), () => JSON.stringify(report))).toThrow('required');
    expect(() => windowsSelfSignature('sign', '/fake', undefined, () => { throw new Error('private-native-diagnostic'); })).toThrow('output suppressed');
  });
  it('rejects unverified ad-hoc/self-signed release reports and unsigned installers', () => {
    const dir = fixture();
    const file = join(dir, 'verified-win32-x64.json');
    const evidence = JSON.parse(readFileSync(file, 'utf8'));
    evidence.signatureVerification = 'not-run'; writeFileSync(file, JSON.stringify(evidence));
    expect(() => verifyRelease(dir, version, sha)).toThrow('Missing native validation');
    evidence.signatureVerification = 'passed'; evidence.certificateSha256 = 'b'.repeat(64);
    writeFileSync(file, JSON.stringify(evidence));
    expect(() => verifyRelease(dir, version, sha)).toThrow('Missing native validation');
    expect(() => stageManifest(dir, version, targets[0], sha, { signing: 'unsigned', notarized: false })).toThrow('Invalid signing');
    expect(() => stageManifest(dir, version, targets[2], sha, { signing: 'self-signed', notarized: false })).toThrow('Invalid signing');
  });
});
