import type { FinancialProviderStatus } from '@finagent/core';
import type { JsonFileStore } from '../storage/json-file-store.ts';

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
}

/** Per-provider user configuration (BYOK API keys etc.). Never exported in diagnostics. */
export interface ProviderConfig {
  apiKey?: string;
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
    const file = await this.store.read<ConnectionsFile>(ConnectionStore.FILE, { connections: [] });
    const index = file.connections.findIndex((existing) => existing.providerId === state.providerId);
    if (index >= 0) {
      file.connections[index] = state;
    } else {
      file.connections.push(state);
    }
    await this.store.write(ConnectionStore.FILE, file);
    this.notify(file.connections);
  }

  async getConfig(providerId: string): Promise<ProviderConfig | undefined> {
    const file = await this.store.read<ConnectionsFile>(ConnectionStore.FILE, { connections: [] });
    return file.configs?.[providerId];
  }

  async setConfig(providerId: string, config: ProviderConfig): Promise<void> {
    const file = await this.store.read<ConnectionsFile>(ConnectionStore.FILE, { connections: [] });
    const configs = { ...(file.configs ?? {}) };
    configs[providerId] = config;
    await this.store.write(ConnectionStore.FILE, { ...file, configs });
    this.notify(file.connections);
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
