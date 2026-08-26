// CredentialStore: OS-backed encrypted credential storage for the main process.
//
// API keys and custom provider configurations are encrypted with Electron's
// safeStorage before touching disk. Secrets NEVER leave the main process:
// the renderer sends credentials in once and only ever receives metadata
// (configured / updatedAt) back. All error paths redact secret material.

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
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
  credentials: Record<string, { encrypted: string; updatedAt?: number }>;
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
  private mutationQueue: Promise<void> = Promise.resolve();

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
    await this.mutate((store) => {
      store.credentials[provider] = {
        encrypted: this.encrypt(apiKey),
        updatedAt: Date.now(),
      };
    });
  }

  async removeCredential(provider: string): Promise<void> {
    await this.mutate((store) => {
      delete store.credentials[provider];
    });
  }

  /** Renderer-safe metadata: no secrets. */
  async listCredentials(): Promise<CredentialInfo[]> {
    const store = await this.load();
    const infos: CredentialInfo[] = Object.entries(store.credentials).map(
      ([provider, entry]) => ({
        provider,
        configured: true,
        updatedAt: entry.updatedAt,
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
    await this.mutate((store) => {
      const updatedAt = Date.now();
      store.customProviders[config.name] = {
        displayName: config.displayName,
        baseUrl: config.baseUrl,
        api: config.api ?? 'openai-completions',
        models: config.models,
        updatedAt,
      };
      if (config.apiKey !== undefined) {
        store.credentials[`custom:${config.name}`] = {
          encrypted: this.encrypt(config.apiKey),
          updatedAt,
        };
      }
    });
  }

  async removeCustomProvider(name: string): Promise<void> {
    await this.mutate((store) => {
      delete store.customProviders[name];
      delete store.credentials[`custom:${name}`];
    });
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
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    try {
      await writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
      await rename(tempPath, this.filePath);
      this.cache = store;
    } catch (error) {
      await unlink(tempPath).catch(() => undefined);
      throw error;
    }
  }

  /** Serialize mutations so concurrent credential updates cannot overwrite each other. */
  private async mutate(update: (store: StoreShape) => void): Promise<void> {
    const operation = this.mutationQueue.then(async () => {
      const store = structuredClone(await this.load());
      update(store);
      await this.persist(store);
    });
    this.mutationQueue = operation.catch(() => undefined);
    return operation;
  }

  private encrypt(plaintext: string): string {
    if (this.isEncryptionAvailable()) {
      return `v1:${safeStorage.encryptString(plaintext).toString('base64')}`;
    }
    throw new Error('Secure credential storage is unavailable on this system');
  }

  private decrypt(payload: string): string {
    if (payload.startsWith('plain:')) {
      return Buffer.from(payload.slice('plain:'.length), 'base64').toString('utf8');
    }
    const base64 = payload.startsWith('v1:') ? payload.slice(3) : payload;
    return safeStorage.decryptString(Buffer.from(base64, 'base64'));
  }

}
