/**
 * Portfolio ledger service (#335): import orchestration over the repository,
 * plus mapping from existing broker surfaces (portfolio snapshot, cash-flow
 * records) into ledger entries. Classification stays DETERMINISTIC — no LLM
 * anywhere near the ledger (#335 acceptance).
 */
import type {
  CashFlowRecord,
  PortfolioLedgerEntryKind,
  PortfolioLedgerFlowDirection,
  PortfolioLedgerImportResult,
  PortfolioLedgerSource,
  PortfolioSnapshot,
  PortfolioTwrResult,
} from '@finagent/core';
import type { PortfolioLedgerRepository } from './repository.ts';
import { computeTwr, type TwrOptions } from './twr.ts';

export class PortfolioLedgerService {
  private readonly repository: PortfolioLedgerRepository;

  constructor(repository: PortfolioLedgerRepository) {
    this.repository = repository;
  }

  async importEntries(
    portfolioId: string,
    inputs: Parameters<PortfolioLedgerRepository['appendBatch']>[1]
  ): Promise<PortfolioLedgerImportResult> {
    return this.repository.appendBatch(portfolioId, inputs);
  }

  async computeTwr(
    portfolioId: string,
    options: Omit<TwrOptions, 'ledgerRevision'> = {}
  ): Promise<PortfolioTwrResult | undefined> {
    const ledger = await this.repository.get(portfolioId);
    if (!ledger) return undefined;
    return computeTwr(ledger.entries, {
      ledgerRevision: ledger.revision,
      ...options,
    });
  }

  async coverage(portfolioId: string) {
    return this.repository.coverage(portfolioId);
  }
}

/** Keyword table for vendor cash-flow classification (deterministic). */
const FLOW_CLASSIFICATION: ReadonlyArray<{
  match: RegExp;
  kind: PortfolioLedgerEntryKind;
  direction: PortfolioLedgerFlowDirection;
}> = [
  { match: /deposit|入金|存入/i, kind: 'external-flow', direction: 'in' },
  { match: /withdraw|出金|提取|取款/i, kind: 'external-flow', direction: 'out' },
  { match: /dividend|分红|派息/i, kind: 'dividend', direction: 'in' },
  { match: /fee|费用|佣金|手续费|利息/i, kind: 'fee', direction: 'out' },
];

/**
 * Classify one vendor cash-flow record into a ledger kind + direction.
 * Unrecognized business types fall back to `trade` (internal) — never to an
 * external flow, because misclassifying an internal movement as external
 * would corrupt the return.
 */
export function classifyCashFlow(record: CashFlowRecord): {
  kind: PortfolioLedgerEntryKind;
  direction?: PortfolioLedgerFlowDirection;
} {
  const text = `${record.businessType ?? ''} ${record.flowName ?? ''} ${record.description ?? ''}`;
  for (const rule of FLOW_CLASSIFICATION) {
    if (rule.match.test(text)) return { kind: rule.kind, direction: rule.direction };
  }
  return { kind: 'trade' };
}

/**
 * Build a stable import identity for a cash-flow record. Vendor records do
 * not always carry ids, so the identity hashes the record's own content —
 * the same record always hashes the same, a corrected record differs.
 */
export function cashFlowSource(record: CashFlowRecord, provider = 'longbridge'): PortfolioLedgerSource {
  const fingerprint = JSON.stringify([
    record.timestamp ?? null,
    record.currency ?? null,
    record.amount ?? null,
    record.businessType ?? null,
    record.flowName ?? null,
    record.symbol ?? null,
  ]);
  return { provider, kind: 'cash-flow', externalId: fingerprint };
}

/** Map vendor cash-flow records into ledger entry inputs. */
export function cashFlowToLedgerEntries(
  portfolioId: string,
  records: CashFlowRecord[],
  provider = 'longbridge'
): Parameters<PortfolioLedgerRepository['appendBatch']>[1] {
  return records.map((record) => {
    const classified = classifyCashFlow(record);
    return {
      portfolioId,
      kind: classified.kind,
      ...(classified.direction ? { direction: classified.direction } : {}),
      occurredAt: (record.timestamp ?? 0) * 1000,
      ...(record.currency ? { currency: record.currency } : {}),
      ...(record.amount !== undefined ? { amount: Math.abs(record.amount) } : {}),
      source: cashFlowSource(record, provider),
      ...(record.description ? { note: record.description } : {}),
    };
  });
}

/**
 * Map one portfolio snapshot into a `valuation` ledger entry (the NAV point
 * the TWR engine consumes). `fxRateToBase` is only stamped when the snapshot
 * reports position values in a currency other than the base and the caller
 * supplies the rate — never invented here.
 */
export function snapshotToValuationEntry(
  portfolioId: string,
  snapshot: PortfolioSnapshot,
  options: { provider?: string; fxRateToBase?: number } = {}
): Parameters<PortfolioLedgerRepository['appendBatch']>[1][number] {
  const source: PortfolioLedgerSource = {
    provider: options.provider ?? 'longbridge',
    kind: 'snapshot',
    externalId: `snapshot:${snapshot.fetchedAt}`,
  };
  return {
    portfolioId,
    kind: 'valuation',
    occurredAt: snapshot.fetchedAt,
    ...(snapshot.baseCurrency ? { currency: snapshot.baseCurrency } : {}),
    ...(options.fxRateToBase !== undefined ? { fxRateToBase: options.fxRateToBase } : {}),
    ...(snapshot.totalAssets !== undefined ? { totalValue: snapshot.totalAssets } : {}),
    ...(snapshot.cash !== undefined ? { cashBalance: snapshot.cash } : {}),
    positions: snapshot.holdings.map((holding) => ({
      symbol: holding.symbol,
      ...(holding.quantity !== undefined ? { quantity: holding.quantity } : {}),
      ...(holding.marketValue !== undefined ? { marketValue: holding.marketValue } : {}),
      ...(holding.currency ? { currency: holding.currency } : {}),
    })),
    source,
  };
}
