import type { ConversationBranch } from '@finagent/core';
import type { JsonFileStore } from './json-file-store.ts';

interface BranchesFile {
  branches: ConversationBranch[];
}

/** Persists immutable conversation-branch metadata for one session. */
export class BranchRepository {
  private readonly store: JsonFileStore;

  constructor(store: JsonFileStore) {
    this.store = store;
  }

  private fileFor(sessionId: string): string {
    return `sessions/${sessionId}/branches.json`;
  }

  async list(sessionId: string): Promise<ConversationBranch[]> {
    const file = await this.store.read<BranchesFile>(this.fileFor(sessionId), { branches: [] });
    return [...file.branches].sort((a, b) => a.createdAt - b.createdAt);
  }

  async get(sessionId: string, branchId: string): Promise<ConversationBranch | null> {
    const branches = await this.list(sessionId);
    return branches.find((branch) => branch.id === branchId) ?? null;
  }

  async create(branch: ConversationBranch): Promise<void> {
    const file = await this.store.read<BranchesFile>(this.fileFor(branch.sessionId), { branches: [] });
    if (file.branches.some((existing) => existing.id === branch.id)) {
      throw new Error(`Conversation branch ${branch.id} already exists.`);
    }
    file.branches.push(branch);
    await this.store.write(this.fileFor(branch.sessionId), file);
  }

  async update(branch: ConversationBranch): Promise<void> {
    const file = await this.store.read<BranchesFile>(this.fileFor(branch.sessionId), { branches: [] });
    const index = file.branches.findIndex((existing) => existing.id === branch.id);
    if (index >= 0) {
      file.branches[index] = branch;
    } else {
      file.branches.push(branch);
    }
    await this.store.write(this.fileFor(branch.sessionId), file);
  }
}
