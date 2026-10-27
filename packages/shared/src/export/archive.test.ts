import { describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ResearchReport } from '@finagent/core';
import recordedReport from '../../../../docs/acceptance/research-recovery/final-report.json';
import { ResearchReportRepository } from '../research/repository.ts';
import { JsonFileStore } from '../storage/json-file-store.ts';
import { buildReportEvidenceBundle } from '../evidence/contract.ts';
import { reportToJson, type ResearchReportArchive } from './archive.ts';

// 项目公开的 DeepSeek / Longbridge 真实验收记录。
const report = recordedReport as ResearchReport;

describe('research JSON archive', () => {
  it('exports the recorded report and its linked evidence without mutating it', () => {
    const before = JSON.stringify(report);
    const json = reportToJson(report);
    const archive: ResearchReportArchive = JSON.parse(json);
    expect(archive.schemaVersion).toBe('folio-research-archive/v1');
    expect(archive.report).toEqual(report);
    expect(archive.evidence).toEqual(buildReportEvidenceBundle(report));
    expect(archive.report.runStatus).toBe('partial');
    expect(archive.report.sections.some((section) => section.verdict === 'unavailable')).toBe(true);
    expect(archive.evidence.claims.length).toBeGreaterThan(0);
    const evidenceIds = new Set(archive.evidence.evidence.map((item) => item.evidenceId));
    const sourceIds = new Set(archive.evidence.sources.map((source) => source.sourceId));
    for (const claim of archive.evidence.claims) {
      for (const id of claim.evidenceIds) expect(evidenceIds.has(id)).toBe(true);
    }
    for (const item of archive.evidence.evidence) expect(sourceIds.has(item.sourceId)).toBe(true);
    expect(JSON.stringify(report)).toBe(before);
    expect(reportToJson(report)).toBe(json);
  });

  it('preserves the archive after the real repository is reopened', async () => {
    const artifacts = resolve(import.meta.dir, '../../../../artifacts');
    await mkdir(artifacts, { recursive: true });
    const directory = await mkdtemp(join(artifacts, 'export-reload-'));
    try {
      const repository = new ResearchReportRepository(new JsonFileStore(directory));
      await repository.saveReport(report);
      const reopened = new ResearchReportRepository(new JsonFileStore(directory));
      const restored = await reopened.getReport(report.id);
      expect(restored).toBeDefined();
      if (!restored) throw new Error('Recorded report was not persisted');
      const json = reportToJson(restored);
      await Bun.write(join(directory, 'report.archive.json'), json);
      const archive: ResearchReportArchive = await Bun.file(join(directory, 'report.archive.json')).json();
      expect(archive.report.id).toBe(report.id);
      expect(archive.report.sections).toEqual(report.sections);
      const evidence = await reopened.getEvidenceBundle(report.id);
      if (!evidence) throw new Error('Persisted evidence bundle is missing');
      expect(archive.evidence).toEqual(evidence);
      expect(json).toBe(reportToJson(report));
    } finally {
      if (!resolve(directory).startsWith(`${artifacts}${process.platform === 'win32' ? '\\' : '/'}`)) {
        throw new Error('Test directory escaped the artifacts directory');
      }
      await rm(directory, { recursive: true, force: true });
    }
  });
});
