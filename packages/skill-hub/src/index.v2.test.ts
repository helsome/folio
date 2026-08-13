import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { SkillHub, parseSkillMarkdown } from './index.ts';

let dir = '';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'skill-hub-v2-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeFileAt(relativePath: string, contents: string) {
  const full = join(dir, relativePath);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, contents, 'utf8');
}

const SKILL_MD = [
  '---',
  'name: market-data',
  'description: Quotes and K-lines. Triggers: "股价", "kline", "quote"',
  'license: MIT',
  'metadata:',
  '  author: longbridge',
  '  version: "1.0.0"',
  '  risk_level: read_only',
  '  default_install: true',
  '  tier: read',
  '---',
  '# Market Data',
  '',
  'Use the CLI for quotes and klines.',
].join('\n');

describe('parseSkillMarkdown', () => {
  it('parses frontmatter and body', () => {
    const parsed = parseSkillMarkdown(SKILL_MD);
    expect(parsed.frontmatter.name).toBe('market-data');
    expect(parsed.body).toContain('# Market Data');
  });

  it('treats files without frontmatter as body-only', () => {
    const parsed = parseSkillMarkdown('plain body');
    expect(parsed.frontmatter).toEqual({});
    expect(parsed.body).toBe('plain body');
  });
});

describe('SkillHub V2', () => {
  it('lists skill resources including references', async () => {
    await writeFileAt('market-data/SKILL.md', SKILL_MD);
    await writeFileAt('market-data/references/quote.md', '# Quote');
    await writeFileAt('market-data/references/depth.md', '# Depth');
    const hub = new SkillHub({ skillsDirectory: dir, stateFile: join(dir, 'state.json') });
    await hub.loadSkills();

    const resources = await hub.listSkillResources('market-data');
    expect(resources.map((resource) => resource.path)).toEqual([
      'references/depth.md',
      'references/quote.md',
      'SKILL.md',
    ]);
    expect(resources.find((resource) => resource.path === 'SKILL.md')?.kind).toBe('skill');
    expect(resources.find((resource) => resource.path === 'references/depth.md')?.kind).toBe('reference');
  });

  it('reads SKILL.md and reference files', async () => {
    await writeFileAt('market-data/SKILL.md', SKILL_MD);
    await writeFileAt('market-data/references/depth.md', '# Depth doc');
    const hub = new SkillHub({ skillsDirectory: dir, stateFile: join(dir, 'state.json') });
    await hub.loadSkills();

    expect(await hub.readSkillMarkdown('market-data')).toContain('# Market Data');
    expect(await hub.readSkillResource('market-data', 'references/depth.md')).toBe('# Depth doc');
  });

  it('rejects path traversal and absolute paths', async () => {
    await writeFileAt('market-data/SKILL.md', SKILL_MD);
    const hub = new SkillHub({ skillsDirectory: dir, stateFile: join(dir, 'state.json') });
    await hub.loadSkills();

    await expect(hub.readSkillResource('market-data', '../secret.txt')).rejects.toThrow('traversal');
    await expect(hub.readSkillResource('market-data', 'references/../../secret.txt')).rejects.toThrow('traversal');
    await expect(hub.readSkillResource('market-data', '/etc/passwd')).rejects.toThrow('Absolute');
    await expect(hub.readSkillResource('market-data', '')).rejects.toThrow('required');
    await expect(hub.readSkillResource('unknown-skill', 'SKILL.md')).rejects.toThrow('not found');
  });

  it('blocks symlink escapes outside the skill directory', async () => {
    await writeFileAt('market-data/SKILL.md', SKILL_MD);
    await writeFileAt('secret.txt', 'top secret');
    await mkdir(join(dir, 'market-data', 'references'), { recursive: true });
    await symlink(join(dir, 'secret.txt'), join(dir, 'market-data', 'references', 'leak.md'));
    const hub = new SkillHub({ skillsDirectory: dir, stateFile: join(dir, 'state.json') });
    await hub.loadSkills();

    await expect(hub.readSkillResource('market-data', 'references/leak.md')).rejects.toThrow('escapes');
  });

  it('does not expose resources of disabled skills', async () => {
    await writeFileAt('market-data/SKILL.md', SKILL_MD);
    const hub = new SkillHub({ skillsDirectory: dir, stateFile: join(dir, 'state.json') });
    await hub.loadSkills();
    await hub.setEnabled('market-data', false);

    await expect(hub.readSkillResource('market-data', 'SKILL.md')).rejects.toThrow('disabled');
    expect(hub.listSkillMetadata()).toEqual([]);
  });

  it('matches skills by query tokens and scores relevance', async () => {
    await writeFileAt(
      'longbridge-market-data/SKILL.md',
      '---\nname: market data\ndescription: Real-time quotes and K-line charts for stocks.\n---\nbody'
    );
    await writeFileAt(
      'longbridge-technical/SKILL.md',
      '---\nname: technical\ndescription: Technical analysis methodology: moving averages, RSI, MACD.\n---\nbody'
    );
    const hub = new SkillHub({ skillsDirectory: dir, stateFile: join(dir, 'state.json') });
    await hub.loadSkills();

    const matches = hub.matchSkills('NVDA kline chart', 5);
    expect(matches[0]?.id).toBe('longbridge-market-data');

    const technical = hub.matchSkills('RSI moving averages', 5);
    expect(technical[0]?.id).toBe('longbridge-technical');

    expect(hub.matchSkills('zzzz nothing matches', 5)).toEqual([]);
  });

  it('extracts trigger keywords from Longbridge-style descriptions', async () => {
    await writeFileAt('lb/SKILL.md', SKILL_MD);
    const hub = new SkillHub({ skillsDirectory: dir, stateFile: join(dir, 'state.json') });
    await hub.loadSkills();

    const metadata = hub.listSkillMetadata()[0];
    expect(metadata.keywords).toContain('股价');
    expect(metadata.keywords).toContain('quote');
    expect(metadata.riskLevel).toBe('read_only');
    expect(metadata.tier).toBe('read');
    expect(metadata.license).toBe('MIT');
    expect(metadata.defaultInstall).toBe(true);
  });
});
