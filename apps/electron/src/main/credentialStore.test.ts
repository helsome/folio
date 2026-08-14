import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

// safeStorage is unavailable outside Electron; encrypt/decrypt through a
// deterministic stand-in so the round-trip contract is still exercised.
mock.module('electron', () => ({
  app: {
    getPath: () => '/tmp/finagent-test',
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) =>
      Buffer.from(`enc:${Buffer.from(value, 'utf8').toString('base64')}`, 'utf8'),
    decryptString: (buffer: Buffer) =>
      buffer.toString('utf8').startsWith('enc:')
        ? Buffer.from(buffer.toString('utf8').slice(4), 'base64').toString('utf8')
        : '',
  },
  Notification: {
    isSupported: () => false,
  },
}));

const { redactSecrets, CredentialStore } = await import('./credentialStore.ts');
let dir = '';
let file = '';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'credstore-'));
  file = join(dir, 'credentials.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('redactSecrets', () => {
  it('redacts key-shaped and JSON apiKey material', () => {
    expect(redactSecrets('key sk-abcdef1234567890 is bad')).toContain('[REDACTED]');
    expect(redactSecrets('{"apiKey": "sk-abcdef1234567890xyz"}')).toContain('[REDACTED]');
    expect(redactSecrets('no secrets here')).toBe('no secrets here');
  });
});

describe('CredentialStore', () => {
  it('round-trips credentials without persisting plaintext', async () => {
    const store = new CredentialStore(file);
    await store.setCredential('anthropic', 'sk-test-secret-value-123');
    await store.setCredential('openai', 'sk-openai-secret-456');

    const raw = await readFile(file, 'utf8');
    expect(raw).not.toContain('sk-test-secret-value-123');
    expect(raw).not.toContain('sk-openai-secret-456');

    expect(await store.getCredential('anthropic')).toBe('sk-test-secret-value-123');
    expect(await store.getCredential('openai')).toBe('sk-openai-secret-456');

    const infos = await store.listCredentials();
    expect(infos.find((info) => info.provider === 'anthropic')?.configured).toBe(true);
  });

  it('removes credentials', async () => {
    const store = new CredentialStore(file);
    await store.setCredential('anthropic', 'sk-secret');
    await store.removeCredential('anthropic');

    expect(await store.getCredential('anthropic')).toBeUndefined();
    expect(await store.listCredentials()).toEqual([]);
  });

  it('stores custom provider configs with encrypted keys', async () => {
    const store = new CredentialStore(file);
    await store.setCustomProvider({
      name: 'myproxy',
      displayName: 'My Proxy',
      baseUrl: 'https://llm.example.com/v1',
      apiKey: 'sk-custom-abcdefgh',
      models: [{ id: 'model-a', name: 'Model A', contextWindow: 128000, reasoning: true }],
    });

    const raw = await readFile(file, 'utf8');
    expect(raw).not.toContain('sk-custom-abcdefgh');

    const loaded = await store.getCustomProvider('myproxy');
    expect(loaded?.displayName).toBe('My Proxy');
    expect(loaded?.apiKey).toBe('sk-custom-abcdefgh');
    expect(loaded?.models[0]?.id).toBe('model-a');
    expect(loaded?.api).toBe('openai-completions');

    const infos = await store.listCredentials();
    expect(infos.find((info) => info.provider === 'myproxy')?.custom).toBe(true);
  });

  it('survives reload from disk (encryption is deterministic per machine)', async () => {
    const store = new CredentialStore(file);
    await store.setCredential('anthropic', 'sk-persisted-999');

    const reloaded = new CredentialStore(file);
    expect(await reloaded.getCredential('anthropic')).toBe('sk-persisted-999');
  });
});
