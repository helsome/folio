import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(new URL('./windows/self-sign.ps1', import.meta.url));
export function windowsSelfSignature(mode, installer, expectedCertificateSha256, execute = execFileSync) {
  const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script, '-Mode', mode, '-Installer', installer];
  if (expectedCertificateSha256) args.push('-ExpectedCertificateSha256', expectedCertificateSha256);
  let result;
  try { result = JSON.parse(execute('pwsh', args, { encoding: 'utf8', stdio: 'pipe', timeout: 120_000 })); }
  catch { throw new Error('Windows in-memory self-signing/integrity verification failed; output suppressed. No persistent-key fallback is allowed.'); }
  if (result.signing !== 'self-signed' || result.notarized !== false || result.integrity !== 'passed' ||
      result.publisherTrust !== 'not-trusted' || result.privateKeyPersisted !== false ||
      !/^[a-f0-9]{64}$/.test(result.certificateSha256 || '') ||
      (expectedCertificateSha256 && result.certificateSha256 !== expectedCertificateSha256) ||
      (mode === 'sign' && result.tamperRejected !== true)) {
    throw new Error('Windows self-signature lacks required integrity/untrusted-publisher/ephemeral-key evidence');
  }
  return result;
}
