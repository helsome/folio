import { describe, expect, it } from 'bun:test';
import { redact, REDACTION_POLICY } from './redact.ts';

describe('redact', () => {
  it('redacts sk- keys', () => {
    expect(redact('key sk-abcdef1234567890 is bad')).toContain('[REDACTED]');
    expect(redact('sk-abcdef1234567890')).not.toContain('abcdef1234567890');
    expect(redact('sk-ant-api03-abcdef1234567890abcdef')).not.toContain('api03-abcdef');
  });

  it('redacts AWS access key ids', () => {
    expect(redact('AKIAIOSFODNN7EXAMPLE')).toBe('[REDACTED]');
    expect(redact('credential AKIAIOSFODNN7EXAMPLE here')).toContain('[REDACTED]');
  });

  it('redacts Bearer tokens but keeps the scheme', () => {
    const out = redact('Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456');
    expect(out).toContain('Bearer [REDACTED]');
    expect(out).not.toContain('abcdefghijklmnopqrstuvwxyz');
  });

  it('redacts X-Api-Key and apiKey header values', () => {
    expect(redact('X-Api-Key: abcdef1234567890')).not.toContain('abcdef1234567890');
    expect(redact('{"apiKey": "sk-abcdef1234567890xyz"}')).not.toContain('sk-abcdef');
    expect(redact('x-api-key=secretvalue123456789')).toContain('[REDACTED]');
  });

  it('redacts JWTs and VCS tokens', () => {
    expect(
      redact('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturehere')
    ).not.toContain('eyJ');
    expect(redact('token ghp_abcdefghijklmnopqrstuvwxyz123456')).toContain('[REDACTED]');
    expect(redact('github_pat_abcdefghijklmnopqrstuvwxyz')).toContain('[REDACTED]');
  });

  it('redacts LangSmith lsv2_ keys inline', () => {
    const suffix = 'b'.repeat(16);
    expect(redact(`send to https://api.smith.langchain.com with key lsv2_pt_${suffix}`)).toContain('[REDACTED]');
    expect(redact(`lsv2_pt_${suffix}`)).not.toContain(suffix);
    expect(redact(`lsv2_sk_${suffix}`)).not.toContain(suffix);
    expect(redact(`lsv2_${suffix}`)).not.toContain(suffix);
    expect(redact(`key=lsv2_sk_${suffix} restart`)).toContain('[REDACTED]');
  });

  it('leaves short or unusual lsv2_ lookalikes alone', () => {
    expect(redact('lsv2_test')).toBe('lsv2_test');
    expect(redact('lsv2_')).toBe('lsv2_');
  });

  it('redacts base64-ish blobs but leaves lowercase hex alone', () => {
    // 72 chars of base64 alphabet (mixed case), no padding.
    const blob = 'ZGlhZ25vc3RpY3Mtc2VjcmV0LWJsb2Itd2l0aC1taXhlZC1jYXNlLTEyMzQ1Njc4OTAtWFla';
    expect(redact(blob)).toBe('[REDACTED]');
    // A 40-char lowercase git SHA must survive (not a secret).
    const sha = 'a'.repeat(40);
    expect(redact(sha)).toBe(sha);
  });

  it('leaves normal fields untouched', () => {
    expect(redact('AAPL.US')).toBe('AAPL.US');
    expect(redact('United States')).toBe('United States');
    expect(redact('claude-3-5-sonnet-20241022')).toBe('claude-3-5-sonnet-20241022');
    expect(redact('0.17.0')).toBe('0.17.0');
    expect(redact('anthropic')).toBe('anthropic');
    expect(redact('market.quote')).toBe('market.quote');
  });

  it('is idempotent', () => {
    const once = redact('sk-abcdef1234567890 AKIAIOSFODNN7EXAMPLE');
    expect(redact(once)).toBe(once);
  });

  it('documents a redaction policy', () => {
    expect(REDACTION_POLICY.length).toBeGreaterThan(0);
    expect(REDACTION_POLICY.toLowerCase()).toContain('key');
  });
});
