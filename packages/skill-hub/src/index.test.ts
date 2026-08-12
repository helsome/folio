import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { SkillHub } from './index.ts';

let dir = '';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'skill-hub-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeSkill(id: string, markdown: string) {
  const directory = join(dir, id);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'SKILL.md'), markdown, 'utf8');
}

describe('SkillHub', () => {
  it('loads SKILL.md files with frontmatter', async () => {
    await writeSkill('market_analysis', [
      '---',
      'name: Market Analysis',
      'keywords: market, 市场, summary',
      '---',
      'You are a market analyst. Summarize market moves.',
    ].join('\n'));
    const hub = new SkillHub({ skillsDirectory: dir, stateFile: join(dir, 'state.json') });

    await hub.loadSkills();

    const skill = hub.getSkill('market_analysis');
    expect(skill).toMatchObject({
      id: 'market_analysis',
      name: 'Market Analysis',
      type: 'prompt',
      trigger: { keywords: ['market', '市场', 'summary'] },
      metadata: { enabled: true },
    });
    expect(skill?.prompt?.system).toContain('market analyst');
  });

  it('derives id and name from the directory when frontmatter is absent', async () => {
    await writeSkill('plain_skill', 'Just a body without frontmatter.');
    const hub = new SkillHub({ skillsDirectory: dir, stateFile: join(dir, 'state.json') });

    await hub.loadSkills();

    expect(hub.getSkill('plain_skill')).toMatchObject({
      id: 'plain_skill',
      name: 'plain_skill',
      trigger: { keywords: [] },
    });
  });

  it('persists enable/disable state across reloads', async () => {
    await writeSkill('market_analysis', '---\nname: Market Analysis\nkeywords: market\n---\nbody');
    const hub = new SkillHub({ skillsDirectory: dir, stateFile: join(dir, 'state.json') });

    await hub.loadSkills();
    await hub.setEnabled('market_analysis', false);

    const reloaded = new SkillHub({ skillsDirectory: dir, stateFile: join(dir, 'state.json') });
    await reloaded.loadSkills();

    expect(reloaded.getSkill('market_analysis')?.metadata.enabled).toBe(false);
  });

  it('skips directories without SKILL.md', async () => {
    await mkdir(join(dir, 'not-a-skill'), { recursive: true });
    const hub = new SkillHub({ skillsDirectory: dir, stateFile: join(dir, 'state.json') });

    await hub.loadSkills();

    expect(hub.listSkills()).toEqual([]);
  });

  it('finds skills by keyword', async () => {
    await writeSkill('market_analysis', '---\nname: Market Analysis\nkeywords: market, summary\n---\nbody');
    const hub = new SkillHub({ skillsDirectory: dir, stateFile: join(dir, 'state.json') });
    await hub.loadSkills();

    expect(hub.findSkillsByKeyword('summary').map((skill) => skill.id)).toEqual(['market_analysis']);
    expect(hub.findSkillsByKeyword('unrelated')).toEqual([]);
  });
});
