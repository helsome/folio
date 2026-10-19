import { describe, expect, it } from 'bun:test';
import { isLangfuseTracingEnabled, serializeLangfuseCredential } from './index.ts';
import { resolveLangfuseBackend } from './resolve.ts';

const SETTINGS = { langfuseTracingEnabled: false, langfuseHost: 'http://localhost:9', privacyLevel: 'standard' } as const;

/** The switch as the real call sites observe it (stored credentials, env flag). */
function backendKind(flag: string | undefined, enabled = false): string {
  const env: NodeJS.ProcessEnv = flag === undefined ? {} : { LANGFUSE_TRACING: flag };
  return resolveLangfuseBackend({
    settings: { ...SETTINGS, langfuseTracingEnabled: enabled },
    storedCredential: serializeLangfuseCredential('pk', 'sk'),
    env,
  }).kind;
}

describe('LANGFUSE_TRACING is parsed once', () => {
  it('enables tracing for every spelled-out truthy flag, in the helper and in the backend', () => {
    for (const flag of ['1', 'true', 'TRUE', 'True', 'yes', 'YES', 'on', 'ON', ' on ', ' true ']) {
      expect(isLangfuseTracingEnabled(SETTINGS, { LANGFUSE_TRACING: flag })).toBe(true);
      expect(backendKind(flag)).toBe('langfuse');
    }
  });

  it('stays off for falsy and unrecognized flags', () => {
    for (const flag of ['0', 'false', 'FALSE', 'off', 'OFF', 'no', 'NO', ' false ', 'maybe', '2', '']) {
      expect(isLangfuseTracingEnabled(SETTINGS, { LANGFUSE_TRACING: flag })).toBe(false);
      expect(backendKind(flag)).toBe('none');
    }
    expect(isLangfuseTracingEnabled(SETTINGS, {})).toBe(false);
    expect(backendKind(undefined)).toBe('none');
  });

  it('lets the stored setting win over a negative env flag', () => {
    expect(isLangfuseTracingEnabled({ langfuseTracingEnabled: true }, { LANGFUSE_TRACING: '0' })).toBe(true);
    expect(backendKind('0', true)).toBe('langfuse');
  });

  it('reads credentials from the env when the flag came from the env', () => {
    expect(
      resolveLangfuseBackend({
        settings: SETTINGS,
        env: { LANGFUSE_TRACING: 'TRUE', LANGFUSE_PUBLIC_KEY: 'pk', LANGFUSE_SECRET_KEY: 'sk' },
      }).kind
    ).toBe('langfuse');
  });
});
