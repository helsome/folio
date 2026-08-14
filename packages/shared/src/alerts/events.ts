import type { AlertTriggerEvent } from '@finagent/core';
import type { JsonFileStore } from '../storage/json-file-store.ts';

const EVENTS_FILE = 'alerts-events.json';
const MAX_EVENTS = 200;

/**
 * Ring buffer of recent trigger events, persisted at `<userData>/alerts-events.json`.
 * Newest events first; bounded to the last 200.
 */
export class AlertEventLog {
  private readonly store: JsonFileStore;

  constructor(store: JsonFileStore) {
    this.store = store;
  }

  async list(): Promise<AlertTriggerEvent[]> {
    try {
      return await this.store.read<AlertTriggerEvent[]>(EVENTS_FILE, []);
    } catch {
      return [];
    }
  }

  async append(event: AlertTriggerEvent): Promise<void> {
    const events = await this.list();
    events.unshift(event);
    await this.store.write(EVENTS_FILE, events.slice(0, MAX_EVENTS));
  }

  async clear(): Promise<void> {
    await this.store.write(EVENTS_FILE, []);
  }
}
