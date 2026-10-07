import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { listSkillResourcesTool, readSkillResourceTool } from './skillResources.ts';

let root = '';
let bundled = '';
let user = '';
const savedMultiple = process.env.FINAGENT_SKILLS_DIRS;
const savedSingle = process.env.FINAGENT_SKILLS_DIR;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pi-skill-resources-'));
  bundled = join(root, 'bundled');
  user = join(root, 'user');
  await Promise.all([mkdir(bundled, { recursive: true }), mkdir(user, { recursive: true })]);
  process.env.FINAGENT_SKILLS_DIRS = JSON.stringify([bundled, user]);
  delete process.env.FINAGENT_SKILLS_DIR;
});

afterEach(async () => {
  if (savedMultiple === undefined) delete process.env.FINAGENT_SKILLS_DIRS;
  else process.env.FINAGENT_SKILLS_DIRS = savedMultiple;
  if (savedSingle === undefined) delete process.env.FINAGENT_SKILLS_DIR;
  else process.env.FINAGENT_SKILLS_DIR = savedSingle;
  await rm(root, { recursive: true, force: true });
});

async function writeSkill(directory: string, id: string, contents: string): Promise<void> {
  const target = join(directory, id);
  await mkdir(join(target, 'references'), { recursive: true });
  await writeFile(join(target, 'SKILL.md'), contents, 'utf8');
  await writeFile(join(target, 'references', 'guide.md'), `${contents} guide`, 'utf8');
}

describe('Pi skill resources with multiple roots', () => {
  it('reads a user skill when it is absent from the bundled root', async () => {
    await writeSkill(user, 'custom-skill', '# User skill');

    const result = await readSkillResourceTool.execute(
      'call-1',
      { skill: 'custom-skill', path: 'SKILL.md' },
      new AbortController().signal
    );

    expect(result.content[0]?.text).toBe('# User skill');
  });

  it('keeps the first configured root authoritative on collisions', async () => {
    await writeSkill(bundled, 'shared-skill', '# Bundled skill');
    await writeSkill(user, 'shared-skill', '# User skill');

    const result = await readSkillResourceTool.execute(
      'call-2',
      { skill: 'shared-skill', path: 'SKILL.md' },
      new AbortController().signal
    );

    expect(result.content[0]?.text).toBe('# Bundled skill');
  });

  it('lists resources from a user skill and rejects invalid ids', async () => {
    await writeSkill(user, 'custom-skill', '# User skill');

    const result = await listSkillResourcesTool.execute(
      'call-3',
      { skill: 'custom-skill' },
      new AbortController().signal
    );

    expect(result.content[0]?.text).toContain('references/guide.md');
    await expect(readSkillResourceTool.execute(
      'call-4',
      { skill: '../escape', path: 'SKILL.md' },
      new AbortController().signal
    )).rejects.toThrow('Invalid skill id');
  });
});
