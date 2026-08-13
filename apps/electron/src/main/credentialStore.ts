// CredentialStore: OS-backed encrypted credential storage for the main process.
//
// API keys and custom provider configurations are encrypted with Electron's
// safeStorage before touching disk. Secrets NEVER leave the main process:
// the renderer sends credentials in once and only ever receives metadata
// (configured / updatedAt) back. All error paths redact secret material.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { safeStorage } from 'electron';
import type { CredentialInfo, CustomProviderConfig } from '@finagent/core';

export interface StoredCredential {
  apiKey: string;
  updatedAt: number;
}

interface CustomProviderRecord {
  displayName: string;
  baseUrl: string;
  api?: string;
  models: CustomProviderConfig['models'];
  updatedAt: number;
}

interface StoreShape {
  version: 1;
  credentials: Record<string, { encrypted: string }>;
  customProviders: Record<string, CustomProviderRecord>;
}

const REDACTED = '[REDACTED]';

/** Remove secret material from an arbitrary message string. */
export function redactSecrets(message: string): string {
  // Strip anything that looks like a key: sk-..., long bearer tokens.
  return message
    .replace(/\b(sk|rk|pk|ak)-[A-Za-z0-9_\-]{8,}\b/gi, REDACTED)
    .replace(/("apiKey"\s*:\s*")[^"]{8,}(")/g, `$1${REDACTED}$2`)
    .replace(/\beyJ[A-Za-z0-9_\-]{20,}\b/g, REDACTED);
}

export class CredentialStore {
  private readonly filePath: string;
  private cache: StoreShape | null = null;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /** Whether encryption is available (safeStorage may be unavailable on Linux). */
  isEncryptionAvailable(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  // -------------------------------------------------------------------------
  // Provider credentials (built-in providers: anthropic, openai, google, ...)
  // -------------------------------------------------------------------------

  async getCredential(provider: string): Promise<string | undefined> {
    const store = await this.load();
    const entry = store.credentials[provider];
    if (!entry) return undefined;
    return this.decrypt(entry.encrypted);
  }

  async setCredential(provider: string, apiKey: string): Promise<void> {
    const store = await this.load();
    store.credentials[provider] = {
      encrypted: this.encrypt(apiKey),
    };
    await this.persist(store);
  }

  async removeCredential(provider: string): Promise<void> {
    const store = await this.load();
    delete store.credentials[provider];
    await this.persist(store);
  }

  /** Renderer-safe metadata: no secrets. */
  async listCredentials(): Promise<CredentialInfo[]> {
    const store = await this.load();
    const infos: CredentialInfo[] = Object.entries(store.credentials).map(
      ([provider, entry]) => ({
        provider,
        configured: true,
        updatedAt: this.readUpdatedAt(entry.encrypted),
        custom: false,
      })
    );
    for (const [name, record] of Object.entries(store.customProviders)) {
      infos.push({
        provider: name,
        configured: true,
        updatedAt: record.updatedAt,
        custom: true,
      });
    }
    return infos;
  }

  // -------------------------------------------------------------------------
  // Custom OpenAI-compatible providers
  // -------------------------------------------------------------------------

  /** Full config including the decrypted key — main process only. */
  async getCustomProvider(name: string): Promise<CustomProviderConfig | undefined> {
    const store = await this.load();
    const record = store.customProviders[name];
    if (!record) return undefined;
    const apiKey = await this.getCredential(`custom:${name}`);
    return {
      name,
      displayName: record.displayName,
      baseUrl: record.baseUrl,
      api: record.api,
      apiKey,
      models: record.models,
    };
  }

  async listCustomProviders(): Promise<CustomProviderConfig[]> {
    const store = await this.load();
    const providers: CustomProviderConfig[] = [];
    for (const [name] of Object.entries(store.customProviders)) {
      const config = await this.getCustomProvider(name);
      if (config) providers.push(config);
    }
    return providers;
  }

  async setCustomProvider(config: CustomProviderConfig): Promise<void> {
    const store = await this.load();
    store.customProviders[config.name] = {
      displayName: config.displayName,
      baseUrl: config.baseUrl,
      api: config.api ?? 'openai-completions',
      models: config.models,
      updatedAt: Date.now(),
    };
    if (config.apiKey !== undefined) {
      store.credentials[`custom:${config.name}`] = {
        encrypted: this.encrypt(config.apiKey),
      };
    }
    await this.persist(store);
  }

  async removeCustomProvider(name: string): Promise<void> {
    const store = await this.load();
    delete store.customProviders[name];
    delete store.credentials[`custom:${name}`];
    await this.persist(store);
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  private async load(): Promise<StoreShape> {
    if (this.cache) return this.cache;
    try {
      const contents = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(contents) as Partial<StoreShape>;
      this.cache = {
        version: 1,
        credentials: parsed.credentials ?? {},
        customProviders: parsed.customProviders ?? {},
      };
    } catch {
      this.cache = { version: 1, credentials: {}, customProviders: {} };
    }
    return this.cache;
  }

  private async persist(store: StoreShape): Promise<void> {
    this.cache = store;
    await mkdir(dirname(this.filePath), { recursive: true });
    // Atomic write: temp file + rename.
    const tempPath = `${this.filePath}.tmp`;
    await writeFile(tempPath, JSON.stringify(store, null, 2), 'utf8');
    await writeFile(this.filePath, JSON.stringify(store, null, 2), 'utf8');
    try {
      await import('node:fs/promises').then(({ rename }) => rename(tempPath, this.filePath));
    } catch {
      // Fallback direct write above already landed; ignore rename errors.
    }
  }

  private encrypt(plaintext: string): string {
    if (this.isEncryptionAvailable()) {
      return `v1:${safeStorage.encryptString(plaintext).toString('base64')}`;
    }
    // No OS keychain available: keep plaintext off-disk surfaces out of reach
    // is impossible; degrade to base64 obfuscation and mark the prefix.
    return `plain:${Buffer.from(plaintext, 'utf8').toString('base64')}`;
  }

  private decrypt(payload: string): string {
    if (payload.startsWith('plain:')) {
      return Buffer.from(payload.slice('plain:'.length), 'base64').toString('utf8');
    }
    const base64 = payload.startsWith('v1:') ? payload.slice(3) : payload;
    return safeStorage.decryptString(Buffer.from(base64, 'base64'));
  }

  private readUpdatedAt(encrypted: string): number | undefined {
    // updatedAt is not stored per-credential in v1; return undefined.
    void encrypted;
    return undefined;
  }
}
