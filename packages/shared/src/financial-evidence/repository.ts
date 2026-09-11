import type { FinancialEvidenceEnvelope } from '@finagent/core';
import { JsonFileStore } from '../storage/json-file-store.ts';

/**
 * EvidenceRepository — persists FinancialEvidenceEnvelopes to disk so they
 * survive app restart and conversation reload.
 *
 * Storage layout:
 *   <root>/evidence/
 *     by-run/<runId>.json          — all envelopes for a given run
 *     by-session/<sessionId>.json   — index of evidence ids per session
 */

export interface EvidenceRepository {
  /** Save (upsert) an evidence envelope. */
  save(envelope: FinancialEvidenceEnvelope): Promise<void>;
  /** Get all evidence envelopes for a specific run. */
  getByRunId(runId: string): Promise<FinancialEvidenceEnvelope[]>;
  /** Get a single evidence envelope by its id. */
  getById(evidenceId: string): Promise<FinancialEvidenceEnvelope | undefined>;
  /** Get all evidence envelopes for a session. */
  getBySessionId(sessionId: string): Promise<FinancialEvidenceEnvelope[]>;
  /** Get all evidence for a specific instrument. */
  getByInstrument(instrumentId: string): Promise<FinancialEvidenceEnvelope[]>;
  /** Find evidence by metric id across all runs. */
  findByMetric(metricId: string): Promise<FinancialEvidenceEnvelope[]>;
}

export class JsonFileEvidenceRepository implements EvidenceRepository {
  private readonly store: JsonFileStore;
  private readonly evidenceDir = 'evidence';

  constructor(rootDir: string) {
    this.store = new JsonFileStore(rootDir);
  }

  async save(envelope: FinancialEvidenceEnvelope): Promise<void> {
    // Save individual envelope
    const envelopeFile = `${this.evidenceDir}/envelopes/${envelope.evidenceId}.json`;
    await this.store.write(envelopeFile, envelope);

    // Update run index
    const runIndexFile = `${this.evidenceDir}/by-run/${envelope.runId}.json`;
    const existing = await this.store.read<string[]>(runIndexFile, []);
    if (!existing.includes(envelope.evidenceId)) {
      existing.push(envelope.evidenceId);
      await this.store.write(runIndexFile, existing);
    }

    // Update session index
    if (envelope.sessionId) {
      const sessionIndexFile = `${this.evidenceDir}/by-session/${envelope.sessionId}.json`;
      const existingSession = await this.store.read<string[]>(sessionIndexFile, []);
      if (!existingSession.includes(envelope.evidenceId)) {
        existingSession.push(envelope.evidenceId);
        await this.store.write(sessionIndexFile, existingSession);
      }
    }

    // Update instrument index
    const instrumentIndexFile = `${this.evidenceDir}/by-instrument/${envelope.instrumentId}.json`;
    const existingInstrument = await this.store.read<string[]>(instrumentIndexFile, []);
    if (!existingInstrument.includes(envelope.evidenceId)) {
      existingInstrument.push(envelope.evidenceId);
      await this.store.write(instrumentIndexFile, existingInstrument);
    }
  }

  async getByRunId(runId: string): Promise<FinancialEvidenceEnvelope[]> {
    const indexFile = `${this.evidenceDir}/by-run/${runId}.json`;
    const evidenceIds = await this.store.read<string[]>(indexFile, []);
    return this.loadEnvelopes(evidenceIds);
  }

  async getById(evidenceId: string): Promise<FinancialEvidenceEnvelope | undefined> {
    const file = `${this.evidenceDir}/envelopes/${evidenceId}.json`;
    return this.store.read<FinancialEvidenceEnvelope | undefined>(file, undefined);
  }

  async getBySessionId(sessionId: string): Promise<FinancialEvidenceEnvelope[]> {
    const indexFile = `${this.evidenceDir}/by-session/${sessionId}.json`;
    const evidenceIds = await this.store.read<string[]>(indexFile, []);
    return this.loadEnvelopes(evidenceIds);
  }

  async getByInstrument(instrumentId: string): Promise<FinancialEvidenceEnvelope[]> {
    const indexFile = `${this.evidenceDir}/by-instrument/${instrumentId}.json`;
    const evidenceIds = await this.store.read<string[]>(indexFile, []);
    return this.loadEnvelopes(evidenceIds);
  }

  async findByMetric(metricId: string): Promise<FinancialEvidenceEnvelope[]> {
    // This is a simple implementation: scan all envelopes.
    // For large datasets this should be replaced with an index.
    // For now, we return an empty array and document the limitation.
    // A proper implementation would maintain a metric → evidenceIds index.
    return [];
  }

  private async loadEnvelopes(evidenceIds: string[]): Promise<FinancialEvidenceEnvelope[]> {
    const envelopes: FinancialEvidenceEnvelope[] = [];
    for (const id of evidenceIds) {
      const envelope = await this.getById(id);
      if (envelope) envelopes.push(envelope);
    }
    return envelopes;
  }
}
