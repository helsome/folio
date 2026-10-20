/**
 * Portfolio performance ledger persistence (#335, Phase A).
 *
 * One JSON document per store (`portfolio-ledger.json`), following the same
 * JsonFileStore + serialized-mutation pattern as the manual portfolio
 * repository. Import is IDEMPOTENT: entries are keyed by a deterministic id
 * derived from their stable import identity, so re-running an import never
 * double-counts. Corrections (same identity, different content) keep the
 * prior version in `history` instead of silently rewriting the record.
 */
import { createHash } from 'node:crypto';
import type {
  PortfolioLedger,
  PortfolioLedgerCoverage,
  PortfolioLedgerEntry,
  PortfolioLedgerImportResult,
  PortfolioLedgerSource,
} from '@finagent/core';
import type { JsonFileStore } from '../storage/json-file-store.ts';

/** Input shape for imports — the id is derived, never caller-supplied. */
export type PortfolioLedgerEntryInput = Omit<PortfolioLedgerEntry, 'id'>;

const FILE = 'portfolio-ledger.json';

/** Deterministic entry id from the stable import identity (#335 A). */
export function ledgerEntryId(source: PortfolioLedgerSource): string {
  const identity = `${source.provider}:${source.kind}:${source.externalId}`;
  return `ple-${createHash('sha256').update(identity).digest('hex').slice(0, 24)}`;
}

export class PortfolioLedgerRepository {
  private static readonly mutations = new Map<string, Promise<void>>();

  private readonly store: JsonFileStore;

  constructor(store: JsonFileStore) {
    this.store = store;
  }

  /** Serialize whole read-modify-write transactions per file path. */
  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    const { resolve } = await import('node:path');
    const path = resolve(this.store.resolve(FILE));
    const key = process.platform === 'win32' ? path.toLowerCase() : path;
    const previous = PortfolioLedgerRepository.mutations.get(key) ?? Promise.resolve();
    const result = previous.then(operation);
    const settled = result.then(
      () => undefined,
      () => undefined
    );
    PortfolioLedgerRepository.mutations.set(key, settled);
    try {
      return await result;
    } finally {
      if (PortfolioLedgerRepository.mutations.get(key) === settled) {
        PortfolioLedgerRepository.mutations.delete(key);
      }
    }
  }

  private async readAll(): Promise<Record<string, PortfolioLedger>> {
    const file = await this.store.read<unknown>(FILE, {});
    if (file === null || typeof file !== 'object') return {};
    const ledgers = (file as { ledgers?: unknown }).ledgers;
    if (ledgers === null || typeof ledgers !== 'object' || Array.isArray(ledgers)) return {};
    return ledgers as Record<string, PortfolioLedger>;
  }

  private async writeAll(ledgers: Record<string, PortfolioLedger>): Promise<void> {
    await this.store.write(FILE, { ledgers });
  }

  async get(portfolioId: string): Promise<PortfolioLedger | undefined> {
    return (await this.readAll())[portfolioId];
  }

  async coverage(portfolioId: string): Promise<PortfolioLedgerCoverage> {
    const ledger = await this.get(portfolioId);
    if (!ledger || ledger.entries.length === 0) {
      return { portfolioId, counts: {}, revision: ledger?.revision ?? 0 };
    }
    const counts: PortfolioLedgerCoverage['counts'] = {};
    for (const entry of ledger.entries) {
      counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
    }
    const times = ledger.entries.map((entry) => entry.occurredAt);
    return {
      portfolioId,
      firstEntryAt: Math.min(...times),
      lastEntryAt: Math.max(...times),
      counts,
      revision: ledger.revision,
    };
  }

  /**
   * Import a batch with stable-identity dedup (#335 A):
   * - new identity → append;
   * - identical content → skip (idempotency);
   * - different content → correct in place, prior version kept in history.
   */
  async appendBatch(
    portfolioId: string,
    inputs: PortfolioLedgerEntryInput[]
  ): Promise<PortfolioLedgerImportResult> {
    return this.mutate(async () => {
      const all = await this.readAll();
      const ledger: PortfolioLedger = all[portfolioId] ?? {
        portfolioId,
        entries: [],
        revision: 0,
        history: {},
      };
      const byId = new Map(ledger.entries.map((entry) => [entry.id, entry]));
      let added = 0;
      let corrected = 0;
      let skipped = 0;

      for (const input of inputs) {
        if (input.portfolioId !== portfolioId) {
          throw new Error(
            `Ledger entry belongs to portfolio "${input.portfolioId}", batch targets "${portfolioId}".`
          );
        }
        const id = ledgerEntryId(input.source);
        const existing = byId.get(id);
        if (!existing) {
          const entry: PortfolioLedgerEntry = { ...input, id };
          ledger.entries.push(entry);
          byId.set(id, entry);
          added += 1;
          continue;
        }
        if (sameContent(existing, input)) {
          skipped += 1;
          continue;
        }
        // Correction: replace in place, keep the prior version (#335 A).
        const history = ledger.history[id] ?? [];
        history.push(existing);
        ledger.history[id] = history;
        byId.set(id, { ...input, id });
        ledger.entries = ledger.entries.map((entry) => (entry.id === id ? byId.get(id)! : entry));
        corrected += 1;
      }

      if (added > 0 || corrected > 0) {
        ledger.revision += 1;
        ledger.entries.sort((a, b) => a.occurredAt - b.occurredAt);
        all[portfolioId] = ledger;
        await this.writeAll(all);
      }
      return { portfolioId, added, corrected, skipped, ledgerRevision: ledger.revision };
    });
  }
}

/** Content equality ignoring the derived id (and history, which lives outside). */
function sameContent(existing: PortfolioLedgerEntry, input: PortfolioLedgerEntryInput): boolean {
  const { id: _ignored, ...rest } = existing;
  return JSON.stringify(rest) === JSON.stringify(input);
}
