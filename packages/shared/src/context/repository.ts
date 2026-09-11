import { randomUUID } from 'node:crypto';
import type {
  ContextDocument,
  ContextSelection,
  ContextSnapshot,
  RunContextBinding,
  VersionedPortfolioContext,
  VersionedWatchlist,
} from '@finagent/core';
import type { JsonFileStore } from '../storage/json-file-store.ts';

const INSTRUMENT_ID = /^[A-Z0-9]{1,5}\.(US|HK|SG|SH|SZ|HAS)$/;

interface ContextFile {
  watchlists: VersionedWatchlist[];
  portfolios: VersionedPortfolioContext[];
  snapshots: ContextSnapshot[];
  bindings: RunContextBinding[];
}

const EMPTY: ContextFile = { watchlists: [], portfolios: [], snapshots: [], bindings: [] };

function validateInstruments(ids: string[]): void {
  const invalid = ids.find((id) => !INSTRUMENT_ID.test(id));
  if (invalid) throw new Error(`Invalid canonical instrument id: ${invalid}`);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class PortfolioContextRepository {
  private static readonly FILE = 'context/versioned-context.json';
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly store: JsonFileStore, private readonly now: () => number = Date.now) {}

  private read(): Promise<ContextFile> {
    return this.store.read<ContextFile>(PortfolioContextRepository.FILE, clone(EMPTY));
  }

  private write(file: ContextFile): Promise<void> {
    return this.store.write(PortfolioContextRepository.FILE, file);
  }

  private mutate<T>(operation: (file: ContextFile) => Promise<T> | T): Promise<T> {
    const previous = this.queue;
    let release = (): void => undefined;
    this.queue = new Promise<void>((resolve) => { release = resolve; });
    return previous.then(async () => {
      try {
        const file = await this.read();
        const result = await operation(file);
        await this.write(file);
        return result;
      } finally {
        release();
      }
    });
  }

  async listWatchlists(): Promise<VersionedWatchlist[]> {
    return (await this.read()).watchlists;
  }

  async listPortfolios(): Promise<VersionedPortfolioContext[]> {
    return (await this.read()).portfolios;
  }

  async saveWatchlist(input: Omit<VersionedWatchlist, 'version' | 'createdAt' | 'updatedAt'>): Promise<VersionedWatchlist> {
    validateInstruments(input.instruments.map((item) => item.instrumentId));
    return this.mutate((file) => {
      const previous = file.watchlists.find((item) => item.id === input.id);
      const at = this.now();
      const next: VersionedWatchlist = { ...clone(input), version: (previous?.version ?? 0) + 1, createdAt: previous?.createdAt ?? at, updatedAt: at };
      file.watchlists = [next, ...file.watchlists.filter((item) => item.id !== input.id)];
      return next;
    });
  }

  async savePortfolio(input: Omit<VersionedPortfolioContext, 'version' | 'createdAt' | 'updatedAt'>): Promise<VersionedPortfolioContext> {
    validateInstruments(input.positions.map((item) => item.instrumentId));
    return this.mutate((file) => {
      const previous = file.portfolios.find((item) => item.id === input.id);
      const at = this.now();
      const next: VersionedPortfolioContext = { ...clone(input), version: (previous?.version ?? 0) + 1, createdAt: previous?.createdAt ?? at, updatedAt: at };
      file.portfolios = [next, ...file.portfolios.filter((item) => item.id !== input.id)];
      return next;
    });
  }

  private async find(selection: ContextSelection): Promise<ContextDocument | undefined> {
    const file = await this.read();
    return selection.kind === 'watchlist'
      ? file.watchlists.find((item) => item.id === selection.id)
      : file.portfolios.find((item) => item.id === selection.id);
  }

  /** Resolve the latest saved document for an explicitly named context. */
  async get(selection: ContextSelection): Promise<ContextDocument | undefined> {
    const document = await this.find(selection);
    return document ? clone(document) : undefined;
  }

  async snapshot(selection: ContextSelection, relevantInstrumentIds?: string[]): Promise<ContextSnapshot> {
    return this.mutate((file) => {
      const snapshot = this.createSnapshot(file, selection, relevantInstrumentIds);
      file.snapshots.push(snapshot);
      return snapshot;
    });
  }

  private createSnapshot(file: ContextFile, selection: ContextSelection, relevantInstrumentIds?: string[]): ContextSnapshot {
    const source = selection.kind === 'watchlist' ? file.watchlists.find((item) => item.id === selection.id) : file.portfolios.find((item) => item.id === selection.id);
    if (!source) throw new Error(`${selection.kind} context not found: ${selection.id}`);
    const allowed = relevantInstrumentIds ? new Set(relevantInstrumentIds) : undefined;
    const document: ContextDocument = selection.kind === 'watchlist'
      ? { ...(source as VersionedWatchlist), instruments: (source as VersionedWatchlist).instruments.filter((item) => !allowed || allowed.has(item.instrumentId)) }
      : { ...(source as VersionedPortfolioContext), positions: (source as VersionedPortfolioContext).positions.filter((item) => !allowed || allowed.has(item.instrumentId)) };
    return { id: `ctx-${selection.kind}-${source.id}-v${source.version}-${this.now()}-${randomUUID()}`, kind: selection.kind, sourceId: source.id, sourceVersion: source.version, createdAt: this.now(), document: clone(document) };
  }

  async bindRun(input: {
    runId: string;
    sessionId: string;
    branchId: string;
    selections: ContextSelection[];
    relevantInstrumentIds?: string[];
  }): Promise<{ binding: RunContextBinding; snapshots: ContextSnapshot[] }> {
    return this.mutate((file) => {
      const snapshots = input.selections.map((selection) => this.createSnapshot(file, selection, input.relevantInstrumentIds));
      file.snapshots.push(...snapshots);
      const binding: RunContextBinding = { runId: input.runId, sessionId: input.sessionId, branchId: input.branchId, snapshotIds: snapshots.map((snapshot) => snapshot.id), boundAt: this.now() };
      file.bindings = [binding, ...file.bindings.filter((item) => item.runId !== input.runId)];
      return { binding, snapshots };
    });
  }

  async bindSnapshots(input: { runId: string; sessionId: string; branchId: string; snapshots: ContextSnapshot[] }): Promise<RunContextBinding> {
    return this.mutate((file) => {
      const binding: RunContextBinding = { runId: input.runId, sessionId: input.sessionId, branchId: input.branchId, snapshotIds: input.snapshots.map((snapshot) => snapshot.id), boundAt: this.now() };
      file.bindings = [binding, ...file.bindings.filter((item) => item.runId !== input.runId)];
      return binding;
    });
  }

  /** Scope is mandatory: another conversation/branch cannot read this binding by run id alone. */
  async getRunContext(runId: string, sessionId: string, branchId: string): Promise<{ binding: RunContextBinding; snapshots: ContextSnapshot[] } | undefined> {
    const file = await this.read();
    const binding = file.bindings.find((item) => item.runId === runId && item.sessionId === sessionId && item.branchId === branchId);
    if (!binding) return undefined;
    const ids = new Set(binding.snapshotIds);
    return { binding, snapshots: file.snapshots.filter((snapshot) => ids.has(snapshot.id)).map(clone) };
  }
}
