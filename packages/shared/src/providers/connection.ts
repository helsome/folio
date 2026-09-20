import type { FinancialProviderStatus, ProviderRoutingConfig } from '@finagent/core';
import type { JsonFileStore } from '../storage/json-file-store.ts';

/**
 * Strip URL userinfo credentials (`scheme://user:pass@host`) from an
 * endpoint before it reaches disk or the UI (issue #93). `ProviderConfig`
 * is the non-secret settings channel — credentials belong in the OS-backed
 * CredentialStore — and userinfo is a credential shape. Scheme, host and
 * path are preserved so the endpoint stays readable; hosts without
 * userinfo pass through untouched.
 */
const ENDPOINT_USERINFO = /(^[a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/i;

export function sanitizeEndpoint(endpoint: string): string {
  return endpoint.replace(ENDPOINT_USERINFO, '$1[REDACTED]@');
}

/**
 * Serialize read-modify-write cycles per target file, across store
 * instances — same idiom as the publish locks in `JsonFileStore`. Every
 * mutating method reads the whole file, edits it and writes it back, so
 * two overlapping updates would otherwise both base their write on the
 * same snapshot and silently drop each other's changes (issue #145).
 */
const connectionWriteLocks = new Map<string, Promise<unknown>>();

async function withWriteLock<T>(target: string, task: () => Promise<T>): Promise<T> {
  const previous = connectionWriteLocks.get(target) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  connectionWriteLocks.set(target, current);
  try {
    return await current;
  } finally {
    if (connectionWriteLocks.get(target) === current) connectionWriteLocks.delete(target);
  }
}

/**
 * Connection lifecycle state for ONE provider (spec §8). Provider-agnostic:
 * any financial-data or broker-account provider records the same shape.
 */
export interface ConnectionState {
  providerId: string;
  status: FinancialProviderStatus;
  /** Epoch ms of the last status check. */
  lastCheck: number;
  /** Epoch ms the provider last reached `connected`. */
  connectedAt?: number;
  /** User-safe failure detail; raw vendor output is forbidden. */
  error?: { code: string; message: string };
}

interface ConnectionsFile {
  connections: ConnectionState[];
  configs?: Record<string, ProviderConfig>;
  routing?: ProviderRoutingConfig;
}

/** Non-secret provider settings. Credentials belong in the OS-backed CredentialStore. */
export interface ProviderConfig {
  enabled?: boolean;
  endpoint?: string;
  region?: string;
}

/**
 * Persists per-provider connection state in a single `connections.json`
 * (under the `userData` dir backing the `JsonFileStore`). Subscribers are
 * notified after every successful `update`, enabling the Connections UI to
 * reflect health changes without polling the file.
 */
export class ConnectionStore {
  private static readonly FILE = 'connections.json';

  private readonly store: JsonFileStore;
  private readonly listeners = new Set<(states: ConnectionState[]) => void>();

  constructor(store: JsonFileStore) {
    this.store = store;
  }

  async list(): Promise<ConnectionState[]> {
    const file = await this.store.read<ConnectionsFile>(ConnectionStore.FILE, { connections: [] });
    return file.connections;
  }

  async get(providerId: string): Promise<ConnectionState | undefined> {
    const connections = await this.list();
    return connections.find((state) => state.providerId === providerId);
  }

  async update(state: ConnectionState): Promise<void> {
    await withWriteLock(this.store.resolve(ConnectionStore.FILE), async () => {
      const file = await this.store.read<ConnectionsFile>(ConnectionStore.FILE, { connections: [] });
      const index = file.connections.findIndex((existing) => existing.providerId === state.providerId);
      if (index >= 0) {
        file.connections[index] = state;
      } else {
        file.connections.push(state);
      }
      await this.store.write(ConnectionStore.FILE, file);
      this.notify(file.connections);
    });
  }

  async getConfig(providerId: string): Promise<ProviderConfig | undefined> {
    const file = await this.store.read<ConnectionsFile>(ConnectionStore.FILE, { connections: [] });
    const config = file.configs?.[providerId];
    // Lazy sanitization: files written before issue #93 may still carry
    // cleartext userinfo in endpoints — never surface it, even at rest.
    if (!config) return config;
    return {
      ...config,
      endpoint: config.endpoint !== undefined ? sanitizeEndpoint(config.endpoint) : undefined,
    };
  }

  async setConfig(providerId: string, config: ProviderConfig): Promise<void> {
    await withWriteLock(this.store.resolve(ConnectionStore.FILE), async () => {
      const file = await this.store.read<ConnectionsFile>(ConnectionStore.FILE, { connections: [] });
      const configs = { ...(file.configs ?? {}) };
      // Copy only the allowlisted non-secret fields. This prevents accidental
      // credential persistence even when an untyped caller supplies apiKey.
      // Endpoints additionally lose userinfo credentials (issue #93).
      configs[providerId] = {
        enabled: config.enabled,
        endpoint: config.endpoint !== undefined ? sanitizeEndpoint(config.endpoint) : undefined,
        region: config.region,
      };
      await this.store.write(ConnectionStore.FILE, { ...file, configs });
      this.notify(file.connections);
    });
  }

  async getRouting(defaults: ProviderRoutingConfig): Promise<ProviderRoutingConfig> {
    const file = await this.store.read<ConnectionsFile>(ConnectionStore.FILE, { connections: [] });
    return file.routing ? { ...file.routing } : { ...defaults };
  }

  async setRouting(routing: ProviderRoutingConfig): Promise<void> {
    await withWriteLock(this.store.resolve(ConnectionStore.FILE), async () => {
      const file = await this.store.read<ConnectionsFile>(ConnectionStore.FILE, { connections: [] });
      await this.store.write(ConnectionStore.FILE, { ...file, routing: { ...routing } });
      this.notify(file.connections);
    });
  }

  /** Subscribe to connection updates. Returns an unsubscribe function. */
  subscribe(listener: (states: ConnectionState[]) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(states: ConnectionState[]): void {
    const snapshot = [...states];
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
