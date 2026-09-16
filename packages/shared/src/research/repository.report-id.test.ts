import { describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ResearchReport } from '@finagent/core';
import { JsonFileStore } from '../storage/json-file-store.ts';
import { ResearchReportRepository } from './repository.ts';

async function withRepository(work: (repository: ResearchReportRepository, root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'folio-research-report-id-'));
  try {
    await work(new ResearchReportRepository(new JsonFileStore(root)), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function report(id: string): ResearchReport {
  return {
    id,
    symbol: 'NVDA.US',
    generatedAt: 1_700_000_000_000,
    summary: 'summary',
    stance: 'neutral',
    confidence: 0.5,
    sections: [],
    bullCase: [],
    bearCase: [],
    catalysts: [],
    risks: [],
    capabilityRuns: [],
    runStatus: 'completed',
  };
}

async function expectInvalid(action: () => Promise<unknown>): Promise<void> {
  let error: unknown;
  try {
    await action();
  } catch (caught) {
    error = caught;
  }
  expect(error).toMatchObject({ code: 'INVALID_ARGUMENT' });
}

describe('ResearchReportRepository report id boundary', () => {
  it('rejects path-like ids before reading outside the reports directory', async () => {
    await withRepository(async (repository, root) => {
      const sentinel = JSON.stringify({ runs: [{ id: 'must-not-be-read' }] });
      await mkdir(join(root, 'research'), { recursive: true });
      await writeFile(join(root, 'research', 'runs.json'), sentinel, 'utf8');

      for (const id of ['../runs', '..\\runs', '/tmp/runs', 'C:\\runs', 'report.json', 'report%2Fruns', 'report\u0000id']) {
        await expectInvalid(() => repository.getReport(id));
      }
      await expectInvalid(() => (repository.getReport as (id: unknown) => Promise<unknown>)(null));

      expect(await readFile(join(root, 'research', 'runs.json'), 'utf8')).toBe(sentinel);
    });
  });

  it('rejects path-like ids before publishing a report or changing the index', async () => {
    await withRepository(async (repository, root) => {
      const sentinel = JSON.stringify({ runs: [{ id: 'must-not-be-overwritten' }] });
      await mkdir(join(root, 'research'), { recursive: true });
      await writeFile(join(root, 'research', 'runs.json'), sentinel, 'utf8');

      await expectInvalid(() => repository.saveReport(report('../runs')));

      expect(await readFile(join(root, 'research', 'runs.json'), 'utf8')).toBe(sentinel);
      await expectInvalid(() => repository.getReport('../runs'));
    });
  });

  it('keeps the serialized write queue usable after rejecting an invalid id', async () => {
    await withRepository(async (repository) => {
      const invalid = repository.saveReport(report('../runs'));
      const valid = repository.saveReport(report('report-valid_1'));

      await expectInvalid(() => invalid);
      await expect(valid).resolves.toBeUndefined();
      expect(await repository.getReport('report-valid_1')).toMatchObject({ id: 'report-valid_1' });
    });
  });

  it('fails closed when an index contains a path-like report id', async () => {
    await withRepository(async (repository, root) => {
      await mkdir(join(root, 'research'), { recursive: true });
      await writeFile(
        join(root, 'research', 'index.json'),
        JSON.stringify({ reports: [{ id: '../runs', symbol: 'NVDA.US', generatedAt: 1, stance: 'neutral', confidence: 0.5 }] }),
        'utf8'
      );

      await expectInvalid(() => repository.listBySymbol('NVDA.US'));
    });
  });
});
