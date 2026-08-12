import type { SessionMeta } from '@finagent/core';
import type { JsonFileStore } from './json-file-store.ts';

interface SessionsFile {
  sessions: SessionMeta[];
}

/**
 * Persists session metadata (index) in a single `sessions.json` file.
 * Messages and runs live per-session under `sessions/<id>/`.
 */
export class SessionRepository {
  private static readonly FILE = 'sessions.json';
  private readonly store: JsonFileStore;

  constructor(store: JsonFileStore) {
    this.store = store;
  }

  async list(): Promise<SessionMeta[]> {
    const file = await this.store.read<SessionsFile>(SessionRepository.FILE, { sessions: [] });
    return [...file.sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<SessionMeta | null> {
    const sessions = await this.list();
    return sessions.find((session) => session.id === id) ?? null;
  }

  async upsert(session: SessionMeta): Promise<void> {
    const file = await this.store.read<SessionsFile>(SessionRepository.FILE, { sessions: [] });
    const index = file.sessions.findIndex((existing) => existing.id === session.id);
    if (index >= 0) {
      file.sessions[index] = session;
    } else {
      file.sessions.push(session);
    }
    await this.store.write(SessionRepository.FILE, file);
  }

  async remove(id: string): Promise<void> {
    const file = await this.store.read<SessionsFile>(SessionRepository.FILE, { sessions: [] });
    file.sessions = file.sessions.filter((session) => session.id !== id);
    await this.store.write(SessionRepository.FILE, file);
    await this.store.remove(`sessions/${id}/messages.json`);
    await this.store.remove(`sessions/${id}/runs.json`);
  }
}
