import { describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InvestmentThesis, ThesisImpact } from '@finagent/core';
import { ThesisImpactRepository, ThesisRepository } from './repository.ts';

const VALID_ID = '3f1c0b7e-5f4a-4a1e-9c2d-8b6f0d2e7a11';

/** Ids that name something other than a single file inside `<storageDir>`. */
const PATH_LIKE_IDS = ['../escaped', '..\\escaped', '/tmp/escaped', 'C:\\escaped', 'nested/escaped', 'thesis.json', 'escaped\u0000id'];

interface Harness {
  theses: ThesisRepository;
  impacts: ThesisImpactRepository;
  /** `<base>/thesis` — the storage dir handed to both repositories. */
  storageDir: string;
  /** `<base>` — anything landing here escaped `<storageDir>`. */
  base: string;
}

async function withRepositories(work: (harness: Harness) => Promise<void>): Promise<void> {
  const base = await mkdtemp(join(tmpdir(), 'folio-thesis-id-'));
  const storageDir = join(base, 'thesis');
  try {
    await work({
      theses: new ThesisRepository({ storageDir }),
      impacts: new ThesisImpactRepository({ storageDir }),
      storageDir,
      base,
    });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

function thesis(id: string): InvestmentThesis {
  return {
    id,
    symbol: 'NVDA.US',
    stance: 'bullish',
    summary: 'summary',
    bullCase: [],
    bearCase: [],
    catalysts: [],
    risks: [],
    evidenceRefs: [],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    lastReviewedAt: 1_700_000_000_000,
  };
}

function impact(thesisId: string): ThesisImpact {
  return {
    id: 'impact-1',
    thesisId,
    symbol: 'NVDA.US',
    evaluatedAt: 1_700_000_000_000,
    kind: 'unchanged',
    summary: 'summary',
    evidence: [],
    thesis: thesis(thesisId),
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

async function readOrUndefined(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

async function plantSentinel(base: string): Promise<string> {
  const sentinel = JSON.stringify({ note: 'must-not-be-touched' });
  await writeFile(join(base, 'escaped.json'), sentinel, 'utf8');
  return sentinel;
}

describe('ThesisRepository id boundary', () => {
  it('rejects path-like ids before writing outside the thesis directory', async () => {
    await withRepositories(async ({ theses, storageDir, base }) => {
      const sentinel = await plantSentinel(base);

      for (const id of PATH_LIKE_IDS) {
        await expectInvalid(() => theses.save(thesis(id)));
      }
      await expectInvalid(() => (theses.save as (value: unknown) => Promise<unknown>)(thesis(null as unknown as string)));

      expect(await readFile(join(base, 'escaped.json'), 'utf8')).toBe(sentinel);
      // Nothing reached the store root either: the guard fires before `mkdir`.
      await expect(readdir(storageDir)).rejects.toThrow();
    });
  });

  it('rejects path-like ids before reading outside the thesis directory', async () => {
    await withRepositories(async ({ theses, base }) => {
      const sentinel = await plantSentinel(base);

      for (const id of [...PATH_LIKE_IDS, '..']) {
        await expectInvalid(() => theses.get(id));
      }

      expect(await readOrUndefined(join(base, 'escaped.json'))).toBe(sentinel);
    });
  });

  it('rejects path-like ids before deleting outside the thesis directory', async () => {
    await withRepositories(async ({ theses, base }) => {
      const sentinel = await plantSentinel(base);

      for (const id of [...PATH_LIKE_IDS, '..']) {
        await expectInvalid(() => theses.delete(id));
      }

      expect(await readOrUndefined(join(base, 'escaped.json'))).toBe(sentinel);
    });
  });

  it('fails closed when the index contains a path-like id', async () => {
    await withRepositories(async ({ theses, storageDir }) => {
      await mkdir(storageDir, { recursive: true });
      await writeFile(
        join(storageDir, 'index.json'),
        JSON.stringify({ '../escaped': { symbol: 'NVDA.US', updatedAt: 1 } }),
        'utf8'
      );

      await expectInvalid(() => theses.list());
      await expectInvalid(() => theses.getBySymbol('NVDA.US'));
    });
  });

  it('keeps the store usable after rejecting an invalid id', async () => {
    await withRepositories(async ({ theses }) => {
      await expectInvalid(() => theses.save(thesis('../escaped')));

      await expect(theses.save(thesis(VALID_ID))).resolves.toMatchObject({ id: VALID_ID });
      expect(await theses.get(VALID_ID)).toMatchObject({ id: VALID_ID });
      expect(await theses.list()).toHaveLength(1);
      expect(await theses.getBySymbol('NVDA.US')).toHaveLength(1);

      await theses.delete(VALID_ID);
      expect(await theses.get(VALID_ID)).toBeUndefined();
      expect(await theses.list()).toHaveLength(0);
    });
  });
});

describe('ThesisImpactRepository id boundary', () => {
  it('rejects path-like thesis ids before writing or reading impacts', async () => {
    await withRepositories(async ({ impacts, storageDir, base }) => {
      const sentinel = await plantSentinel(base);

      for (const id of PATH_LIKE_IDS) {
        await expectInvalid(() => impacts.append(impact(id)));
        await expectInvalid(() => impacts.list(id));
      }

      expect(await readFile(join(base, 'escaped.json'), 'utf8')).toBe(sentinel);
      await expect(readdir(storageDir)).rejects.toThrow();
    });
  });

  it('round-trips impacts for a valid thesis id', async () => {
    await withRepositories(async ({ impacts, storageDir }) => {
      expect(await impacts.list(VALID_ID)).toEqual([]);

      await impacts.append(impact(VALID_ID));
      expect(await impacts.list(VALID_ID)).toHaveLength(1);
      expect(await readdir(join(storageDir, 'impacts'))).toEqual([`${VALID_ID}.json`]);
    });
  });
});
