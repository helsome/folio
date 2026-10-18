import { spawnSync } from 'node:child_process';
export const appleKeys = ['APPLE_CERTIFICATE_BASE64', 'APPLE_CERT_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'];
export function appleSigningEnabled(platform, env) {
  if (platform !== 'darwin' || env.FOLIO_ALLOW_APPLE_SIGNING !== '1') return false;
  const configured = appleKeys.filter((key) => Boolean(env[key]));
  if (!configured.length) return false;
  const missing = appleKeys.filter((key) => !env[key]);
  if (missing.length) throw new Error(`Incomplete existing Apple signing configuration: ${missing.join(', ')}`);
  return true;
}
function capturedCommand(command, args, options) {
  const result = spawnSync(command, args, options);
  if (result.error || result.status !== 0) throw new Error('Signing command failed');
  // codesign identity details use stderr, requirements use stdout. Neither is logged.
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}
function singleField(output, key) {
  const values = output.split(/\r?\n/).filter((line) => line.startsWith(`${key}=`))
    .map((line) => line.slice(key.length + 1).trim());
  return values.length === 1 ? values[0] : undefined;
}
export function verifyMacSigning(appPath, expectedTeam, execute = capturedCommand) {
  function run(command, args) {
    try { return execute(command, args, { encoding: 'utf8', stdio: 'pipe', timeout: 120_000 }); }
    catch { throw new Error(`macOS signature/notarization verification failed (${command}); tool output suppressed`); }
  }
  run('codesign', ['--verify', '--deep', '--strict', appPath]);
  const details = run('codesign', ['--display', '--verbose=4', appPath]);
  const team = singleField(details, 'TeamIdentifier');
  const identifier = singleField(details, 'Identifier');
  const requirement = run('codesign', ['--display', '--requirements', '-', appPath]);
  const requirementTeams = [...requirement.matchAll(/certificate leaf\[subject\.OU\]\s*=\s*(?:"([^"]+)"|([A-Za-z0-9]+))(?=\s|$)/g)]
    .map((match) => match[1] || match[2]);
  if (!team || team === 'not set' || identifier !== 'com.finagent.app' ||
      (expectedTeam && team !== expectedTeam) || requirementTeams.length !== 1 || requirementTeams[0] !== team ||
      !/^Authority=Developer ID Application: .+$/m.test(details) ||
      !requirement.includes('anchor apple generic') || !requirement.includes('1.2.840.113635.100.6.1.13')) {
    throw new Error('Expected Developer ID Application signature and exact configured team; ad-hoc/development signatures are insufficient');
  }
  run('xcrun', ['stapler', 'validate', appPath]);
  run('spctl', ['--assess', '--type', 'execute', appPath]);
  return { signing: 'developer-id', notarized: true };
}
