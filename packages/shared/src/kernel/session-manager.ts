import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { ConversationBranch, Message, Run, Session, SessionMeta } from '@finagent/core';
import type {
  BranchRepository,
  MessageRepository,
  RunRepository,
  SessionRepository,
} from '../storage/index.ts';
import { materializeBranchMessages } from './conversation-projection.ts';

export interface SessionManagerOptions {
  sessions: SessionRepository;
  messages: MessageRepository;
  runs: RunRepository;
  branches: BranchRepository;
  /** Directory holding one runtime session file per Folio session. */
  piSessionDir: string;
  now?: () => number;
}

/**
 * Owns session lifecycle and persistence. The renderer never writes sessions
 * directly; everything goes through this manager, so Jotai stays a view cache
 * and the repository stays the source of truth.
 */
export class SessionManager {
  private readonly sessions: SessionRepository;
  private readonly messages: MessageRepository;
  private readonly runs: RunRepository;
  private readonly branches: BranchRepository;
  private readonly piSessionDir: string;
  private readonly now: () => number;

  constructor(options: SessionManagerOptions) {
    this.sessions = options.sessions;
    this.messages = options.messages;
    this.runs = options.runs;
    this.branches = options.branches;
    this.piSessionDir = options.piSessionDir;
    this.now = options.now ?? Date.now;
  }

  async listSessions(): Promise<SessionMeta[]> {
    return this.sessions.list();
  }

  async getSession(id: string): Promise<SessionMeta | null> {
    return this.sessions.get(id);
  }

  async createSession(title?: string): Promise<SessionMeta> {
    const id = randomUUID();
    const branchId = randomUUID();
    const now = this.now();
    const session: Session = {
      id,
      title: title?.trim() || 'New Session',
      status: 'idle',
      createdAt: now,
      updatedAt: now,
      activeBranchId: branchId,
      runtimeSessionPath: join(this.piSessionDir, `${id}.jsonl`),
    };
    const meta: SessionMeta = { ...session, messageCount: 0 };
    await this.sessions.upsert(meta);
    await this.branches.create({
      id: branchId,
      sessionId: id,
      name: 'Main',
      createdAt: now,
      updatedAt: now,
    });
    return meta;
  }

  async deleteSession(id: string): Promise<void> {
    await this.sessions.remove(id);
  }

  /** Persist a session field update and refresh `updatedAt`. */
  async updateSession(id: string, patch: Partial<Session>): Promise<SessionMeta | null> {
    const current = await this.sessions.get(id);
    if (!current) return null;
    const updated: SessionMeta = {
      ...current,
      ...patch,
      updatedAt: this.now(),
    };
    await this.sessions.upsert(updated);
    return updated;
  }

  /**
   * Return the visible transcript for a branch.  With no branch argument the
   * session's persisted active branch is used, which is what the renderer
   * should display after a reload.
   */
  async listMessages(sessionId: string, branchId?: string): Promise<Message[]> {
    const allMessages = await this.messages.list(sessionId);
    const branch = branchId
      ? await this.branches.get(sessionId, branchId)
      : await this.getActiveBranch(sessionId);
    if (!branch) return allMessages;
    const branches = await this.branches.list(sessionId);
    return materializeBranchMessages(allMessages, branches, branch.id);
  }

  /** Raw append-only message artifacts, including messages hidden by branches. */
  async listAllMessages(sessionId: string): Promise<Message[]> {
    return this.messages.list(sessionId);
  }

  /** Persist a message and keep the session index stats in sync. */
  async appendMessage(sessionId: string, message: Message): Promise<Message[]> {
    const messages = await this.messages.append(sessionId, message);
    const session = await this.sessions.get(sessionId);
    if (session) {
      await this.sessions.upsert({
        ...session,
        messageCount: messages.length,
        lastMessageAt: message.timestamp,
        updatedAt: this.now(),
      });
    }
    return messages;
  }

  async listRuns(sessionId: string): Promise<Run[]> {
    return this.runs.list(sessionId);
  }

  async getRun(sessionId: string, runId: string): Promise<Run | null> {
    return this.runs.get(sessionId, runId);
  }

  /** Return all branches, creating a Main branch for legacy sessions on first read. */
  async listBranches(sessionId: string): Promise<ConversationBranch[]> {
    const session = await this.sessions.get(sessionId);
    if (!session) return [];
    await this.ensureDefaultBranch(session);
    return this.branches.list(sessionId);
  }

  async getBranch(sessionId: string, branchId: string): Promise<ConversationBranch | null> {
    await this.listBranches(sessionId);
    return this.branches.get(sessionId, branchId);
  }

  async getActiveBranch(sessionId: string): Promise<ConversationBranch | null> {
    const session = await this.sessions.get(sessionId);
    if (!session) return null;
    const branch = await this.ensureDefaultBranch(session);
    return branch;
  }

  /** Persist the branch selected by the user and return it after validation. */
  async setActiveBranch(sessionId: string, branchId: string): Promise<ConversationBranch | null> {
    const session = await this.sessions.get(sessionId);
    if (!session) return null;
    const branch = await this.branches.get(sessionId, branchId);
    if (!branch) return null;
    await this.sessions.upsert({ ...session, activeBranchId: branchId, updatedAt: this.now() });
    return branch;
  }

  /** Persist runtime identity discovered after a native branch operation. */
  async updateBranch(
    sessionId: string,
    branchId: string,
    patch: Partial<ConversationBranch>
  ): Promise<ConversationBranch | null> {
    const branch = await this.branches.get(sessionId, branchId);
    if (!branch) return null;
    const updated: ConversationBranch = {
      ...branch,
      ...patch,
      id: branch.id,
      sessionId: branch.sessionId,
      updatedAt: this.now(),
    };
    await this.branches.update(updated);
    return updated;
  }

  /** Create an immutable child branch from the selected parent cursor. */
  async createBranch(input: {
    sessionId: string;
    name?: string;
    parentBranchId?: string;
    forkMessageId?: string | null;
    runtimeLeafId?: string;
    runtimeSessionPath?: string;
    runtimeForkEntryId?: string;
  }): Promise<ConversationBranch> {
    const session = await this.sessions.get(input.sessionId);
    if (!session) throw new Error(`Session ${input.sessionId} was not found.`);

    const now = this.now();
    const branch: ConversationBranch = {
      id: randomUUID(),
      sessionId: input.sessionId,
      name: input.name?.trim() || `Branch ${now}`,
      createdAt: now,
      updatedAt: now,
      parentBranchId: input.parentBranchId,
      forkMessageId: input.parentBranchId ? input.forkMessageId ?? null : undefined,
      runtimeLeafId: input.runtimeLeafId,
      runtimeSessionPath: input.runtimeSessionPath,
      runtimeForkEntryId: input.runtimeForkEntryId,
    };
    if (branch.parentBranchId && !(await this.branches.get(input.sessionId, branch.parentBranchId))) {
      throw new Error(`Parent branch ${branch.parentBranchId} was not found.`);
    }
    await this.branches.create(branch);
    return branch;
  }

  private async ensureDefaultBranch(session: SessionMeta): Promise<ConversationBranch> {
    const existing = await this.branches.list(session.id);
    const selected = session.activeBranchId
      ? existing.find((branch) => branch.id === session.activeBranchId)
      : undefined;
    if (selected) return selected;

    const root = existing.find((branch) => !branch.parentBranchId);
    if (root) {
      await this.sessions.upsert({ ...session, activeBranchId: root.id, updatedAt: this.now() });
      return root;
    }

    const now = this.now();
    const branch: ConversationBranch = {
      id: randomUUID(),
      sessionId: session.id,
      name: 'Main',
      createdAt: session.createdAt || now,
      updatedAt: now,
    };
    await this.branches.create(branch);
    await this.sessions.upsert({ ...session, activeBranchId: branch.id, updatedAt: now });
    return branch;
  }
}
