import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { SkillHub } from './index.ts';

let root = '';
let bundled = '';
let user = '';
let source = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'skill-installer-'));
  bundled = join(root, 'bundled');
  user = join(root, 'user');
  source = join(root, 'source');
  await Promise.all([
    mkdir(bundled, { recursive: true }),
    mkdir(user, { recursive: true }),
    mkdir(source, { recursive: true }),
  ]);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeSkill(directory: string, id: string, name = id): Promise<string> {
  const target = join(directory, id);
  await mkdir(join(target, 'references'), { recursive: true });
  await writeFile(join(target, 'SKILL.md'), [
    '---',
    `name: ${name}`,
    `description: ${name} test skill`,
    '---',
    `# ${name}`,
  ].join('\n'), 'utf8');
  await writeFile(join(target, 'references', 'guide.md'), '# Guide', 'utf8');
  return target;
}

function createHub(): SkillHub {
  return new SkillHub({
    skillsDirectories: [
      { path: bundled, source: 'bundled' },
      { path: user, source: 'user' },
    ],
    stateFile: join(root, 'state.json'),
  });
}

describe('SkillHub user packages', () => {
  it('loads bundled and user roots while preserving bundled priority', async () => {
    await writeSkill(bundled, 'shared', 'Bundled Shared');
    await writeSkill(user, 'shared', 'User Shared');
    await writeSkill(user, 'custom', 'Custom');
    const hub = createHub();

    await hub.loadSkills();

    expect(hub.getSkill('shared')?.name).toBe('Bundled Shared');
    expect(hub.getSkill('custom')?.name).toBe('Custom');
    expect(hub.listAllSkillMetadata().find((entry) => entry.id === 'shared')?.source).toBe('bundled');
    expect(hub.listAllSkillMetadata().find((entry) => entry.id === 'custom')?.source).toBe('user');
  });

  it('atomically installs a valid package and reloads it', async () => {
    const selected = await writeSkill(source, 'portfolio-notes', 'Portfolio Notes');
    const hub = createHub();
    await hub.loadSkills();

    const result = await hub.installSkillFromDirectory(selected);

    expect(result).toMatchObject({
      skillId: 'portfolio-notes',
      name: 'Portfolio Notes',
      source: 'user',
    });
    expect(await readFile(join(user, 'portfolio-notes', 'references', 'guide.md'), 'utf8')).toBe('# Guide');
    expect(hub.getSkill('portfolio-notes')?.name).toBe('Portfolio Notes');
    expect((await readdir(user)).some((entry) => entry.startsWith('.install-'))).toBe(false);
  });

  it('rejects packages that collide with a bundled skill', async () => {
    await writeSkill(bundled, 'market-data', 'Market Data');
    const selected = await writeSkill(source, 'market-data', 'Replacement');
    const hub = createHub();
    await hub.loadSkills();

    await expect(hub.installSkillFromDirectory(selected)).rejects.toThrow('already installed');
    expect(await readdir(user)).toEqual([]);
  });

  it('rejects symbolic links without leaving a partial install', async () => {
    const selected = await writeSkill(source, 'unsafe-skill', 'Unsafe Skill');
    const outside = join(root, 'outside.txt');
    await writeFile(outside, 'secret', 'utf8');
    await symlink(outside, join(selected, 'references', 'leak.md'));
    const hub = createHub();
    await hub.loadSkills();

    await expect(hub.installSkillFromDirectory(selected)).rejects.toThrow('symbolic links');
    expect(await readdir(user)).toEqual([]);
  });

  it('allows removal lookup only for user-installed skills', async () => {
    await writeSkill(bundled, 'built-in', 'Built In');
    await writeSkill(user, 'mine', 'Mine');
    const hub = createHub();
    await hub.loadSkills();

    expect(hub.userSkillDirectory('mine')).toBe(join(user, 'mine'));
    expect(() => hub.userSkillDirectory('built-in')).toThrow('Bundled skills cannot be removed');
  });

  it('ignores manually placed user packages with unsafe ids', async () => {
    await writeSkill(user, 'unsafe_id', 'Unsafe');
    const hub = createHub();

    await hub.loadSkills();

    expect(hub.getSkill('unsafe_id')).toBeUndefined();
  });
});
