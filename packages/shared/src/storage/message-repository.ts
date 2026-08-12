import type { Message } from '@finagent/core';
import type { JsonFileStore } from './json-file-store.ts';

interface MessagesFile {
  messages: Message[];
}

/** Persists the visible transcript of one session as a JSON array. */
export class MessageRepository {
  private readonly store: JsonFileStore;

  constructor(store: JsonFileStore) {
    this.store = store;
  }

  private fileFor(sessionId: string): string {
    return `sessions/${sessionId}/messages.json`;
  }

  async list(sessionId: string): Promise<Message[]> {
    const file = await this.store.read<MessagesFile>(this.fileFor(sessionId), { messages: [] });
    return file.messages;
  }

  async append(sessionId: string, message: Message): Promise<Message[]> {
    const file = await this.store.read<MessagesFile>(this.fileFor(sessionId), { messages: [] });
    file.messages.push(message);
    await this.store.write(this.fileFor(sessionId), file);
    return file.messages;
  }
}
