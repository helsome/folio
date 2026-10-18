import { execFileSync } from 'node:child_process';
export const appleKeys = ['APPLE_CERTIFICATE_BASE64', 'APPLE_CERT_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'];
export function appleSigningEnabled(platform, env) {
  if (platform !== 'darwin' || env.FOLIO_ALLOW_APPLE_SIGNING !== '1') return false;
  const configured = appleKeys.filter((key) => Boolean(env[key]));
  if (!configured.length) return false;
  const missing = appleKeys.filter((key) => !env[key]);
  if (missing.length) throw new Error(`Incomplete existing Apple signing configuration: ${missing.join(', ')}`);
  return true;
}
export function verifyMacSigning(appPath, expectedTeam, execute = execFileSync) {
  function run(command, args) {
    try { return execute(command, args, { encoding: 'utf8', stdio: 'pipe', timeout: 120_000 }); }
    catch { throw new Error(`macOS signature/notarization verification failed (${command}); tool output suppressed`); }
  }
  run('codesign', ['--verify', '--deep', '--strict', appPath]);
  // Designated requirements go to stdout; identity diagnostics stay captured.
  const requirement = run('codesign', ['--display', '--requirements', '-', appPath]);
  if (!requirement.includes('anchor apple generic') || !requirement.includes('1.2.840.113635.100.6.1.13') ||
      (expectedTeam && !requirement.includes(`subject.OU] = ${expectedTeam}`) && !requirement.includes(`subject.OU] = "${expectedTeam}"`))) {
    throw new Error('Expected Developer ID Application signature and configured team; ad-hoc/development signatures are insufficient');
  }
  run('xcrun', ['stapler', 'validate', appPath]);
  run('spctl', ['--assess', '--type', 'execute', appPath]);
  return { signing: 'developer-id', notarized: true };
}
