import { describe, expect, it } from 'bun:test';
import { redactText } from './redact-text.ts';

describe('redactText — issue #19 secret classes', () => {
  it('redacts provider API keys', () => {
    expect(redactText('using key sk-abcdef1234567890 now')).not.toContain('abcdef1234567890');
    expect(redactText('key sk-ant-api03-abcdef1234567890abcdef')).not.toContain('api03-abcdef');
    expect(redactText('Google AIzaSyA1234567890abcdefghijklmnopqrstuv')).toContain('[REDACTED]');    expect(redactText('slack xoxb-123456789012-1234567890123-abc')).toContain('[REDACTED]');
    expect(redactText('sendgrid SG.abcdef1234567890.zyxwvutsrqponmlkji')).toContain('[REDACTED]');
    expect(redactText('gitlab glpat-abcdefghijklmnopqrst')).toContain('[REDACTED]');
  });

  it('redacts Authorization headers (Bearer and Basic)', () => {
    expect(redactText('Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456')).toBe(
      'Authorization: Bearer [REDACTED]'
    );
    expect(redactText('authorization: Basic dXNlcjpwYXNzd29yZA==')).toContain('Basic [REDACTED]');
  });

  it('redacts cookie and session headers', () => {
    const out = redactText('cookie: session=abc123def456; theme=dark');
    expect(out).toContain('[REDACTED]');
    expect(out).not.toContain('abc123def456');
    expect(redactText('Set-Cookie: sid=deadbeefcafebabe')).not.toContain('deadbeefcafebabe');
    expect(redactText('"session_token": "xyz987654321"')).not.toContain('xyz987654321');
  });

  it('redacts connection strings with credentials', () => {
    const out = redactText('postgres://folio_user:hunter2@db.internal:5432/folio');
    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('folio_user:');
    expect(out).toContain('postgres://[REDACTED]@db.internal:5432/folio');
    expect(redactText('redis://:secretpw@cache.internal:6379/0')).not.toContain('secretpw');
    expect(redactText('mongodb+srv://reader:pw123456@cluster0.example.net')).not.toContain('pw123456');
  });

  it('redacts webhook secrets and signatures', () => {
    expect(redactText('stripe whsec_abcdef1234567890abcdef')).not.toContain('abcdef1234567890');
    expect(redactText('x-hub-signature-256: sha256=abcdef1234567890abcdef1234567890abcdef12')).toContain(
      '[REDACTED]'
    );
    expect(redactText('"webhook_secret": "whsec_abcdefghijklm"')).not.toContain('whsec_abcdefghijkl');
  });

  it('redacts secrets inside URL query strings', () => {
    const out = redactText('https://api.example.com/v1/quotes?symbol=AAPL&apikey=abcdef1234567890');
    expect(out).toContain('symbol=AAPL');
    expect(out).not.toContain('abcdef1234567890');
    expect(redactText('https://host/pull?access_token=gho_16C7e42F292c6912E7710c838347Ae178B4a')).not
      .toContain('gho_16C7e42F292c6912E7710c838347');
    expect(redactText('https://host/cb#token=abcdefgh12345678&state=x')).not.toContain('abcdefgh12345678');
    // Benign query parameters survive.
    expect(redactText('https://host/quotes?symbol=AAPL.US&range=1d')).toBe(
      'https://host/quotes?symbol=AAPL.US&range=1d'
    );
  });

  it('redacts private key PEM blocks', () => {
    const pem = [
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEpAIBAAKCAQEA7x9zLm/PlaceholderKeyMaterialForTesting1234567890',
      '-----END RSA PRIVATE KEY-----',
    ].join('\n');
    const out = redactText(`failed to load key:\n${pem}\nretry`);
    expect(out).toContain('[REDACTED]');
    expect(out).not.toContain('MIIEpAIBAAKCAQEA');
    expect(out).toContain('failed to load key:');
  });

  it('redacts secrets echoed inside HTTP error bodies', () => {
    const body = 'Request failed with status 401: {"error":{"message":"Incorrect API key provided: sk-abcdef1234567890xyz"}}';
    const out = redactText(body);
    expect(out).toContain('401');
    expect(out).not.toContain('sk-abcdef1234567890xyz');
  });

  it('preserves observability fields (ids, names, statuses, versions)', () => {
    expect(redactText('run_1a2b3c4d-5678-4ef0-ab12-cd34ef56ab78')).toBe(
      'run_1a2b3c4d-5678-4ef0-ab12-cd34ef56ab78'
    );
    expect(redactText('1a2b3c4d-5678-4ef0-ab12-cd34ef56ab78')).toBe('1a2b3c4d-5678-4ef0-ab12-cd34ef56ab78');
    expect(redactText('market.quote')).toBe('market.quote');
    expect(redactText('completed')).toBe('completed');
    expect(redactText('claude-3-5-sonnet-20241022')).toBe('claude-3-5-sonnet-20241022');
    expect(redactText('AAPL.US')).toBe('AAPL.US');
    expect(redactText('latencyMs=1234, status=ok, toolName=get_quote')).toBe(
      'latencyMs=1234, status=ok, toolName=get_quote'
    );
    // 40-char lowercase git SHA survives (not a secret).
    expect(redactText('a'.repeat(40))).toBe('a'.repeat(40));
  });

  it('is idempotent', () => {
    const once = redactText(
      'Authorization: Bearer abcdefghijklmnop && postgres://u:pw@h/d and sk-abcdef1234567890'
    );
    expect(redactText(once)).toBe(once);
  });

  it('keeps short lookalikes untouched', () => {
    expect(redactText('lsv2_test')).toBe('lsv2_test');
    expect(redactText('password')).toBe('password');
    expect(redactText('0.17.0')).toBe('0.17.0');
  });
});
