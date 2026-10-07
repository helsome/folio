import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'bun:test';
import { SkillHub, parseSkillMarkdown } from './index.ts';

/**
 * `SKILL.md` frontmatter is documented as YAML, and every bundled Longbridge
 * skill writes its `description` as a block scalar (`|` literal, or `>` folded
 * for `longbridge-earnings`). The parser must read those scalars: the value is
 * the indented block, and the block's own `Key: value` lines belong to the
 * description — they are not frontmatter keys.
 */
describe('parseSkillMarkdown block scalars', () => {
  const LITERAL = [
    '---',
    'name: market-data',
    'description: |',
    '  Real-time quotes and K-line charts.',
    '  Triggers: "股价", "kline", "quote"',
    'license: MIT',
    'metadata:',
    '  author: longbridge',
    '  tier: read',
    '---',
    '# Market Data',
  ].join('\n');

  it('reads a literal block scalar instead of the `|` indicator', () => {
    const parsed = parseSkillMarkdown(LITERAL);
    expect(parsed.frontmatter.description).toBe(
      'Real-time quotes and K-line charts.\nTriggers: "股价", "kline", "quote"\n'
    );
  });

  it('does not turn the block body into bogus frontmatter keys', () => {
    const parsed = parseSkillMarkdown(LITERAL);
    expect(Object.keys(parsed.frontmatter)).toEqual([
      'name',
      'description',
      'license',
      'metadata',
    ]);
  });

  it('still parses the nested metadata block and inline scalars', () => {
    const parsed = parseSkillMarkdown(LITERAL);
    expect(parsed.frontmatter.metadata).toEqual({ author: 'longbridge', tier: 'read' });
    expect(parsed.frontmatter.license).toBe('MIT');
  });

  it('folds a `>` block scalar onto one line', () => {
    const parsed = parseSkillMarkdown(
      ['---', 'name: earnings', 'description: >', '  First line,', '  second line.', '---', 'body'].join('\n')
    );
    expect(parsed.frontmatter.description).toBe('First line, second line.\n');
  });

  it('honours the `-` chomping indicator', () => {
    const parsed = parseSkillMarkdown(
      ['---', 'name: x', 'description: |-', '  One line.', '---', 'body'].join('\n')
    );
    expect(parsed.frontmatter.description).toBe('One line.');
  });

  it('keeps quoted scalars literal', () => {
    const parsed = parseSkillMarkdown(
      ['---', 'name: x', 'description: "|"', '---', 'body'].join('\n')
    );
    expect(parsed.frontmatter.description).toBe('|');
  });
});

/**
 * The regression guard for the shipped defect: the real vendored skills under
 * `skills/` are the only production input to this parser, and every one of them
 * used to load with `description === '|'` (or `'>'`), which is what the agent
 * system prompt renders via `buildSkillIndexSection`.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const skillsDir = join(repoRoot, 'skills');
const hasBundledSkills = existsSync(skillsDir);

describe.if(hasBundledSkills)('bundled skills frontmatter', () => {
  it('loads a real description (not the block indicator) for every skill', async () => {
    const hub = new SkillHub({
      skillsDirectory: skillsDir,
      stateFile: join(tmpdir(), 'skill-hub-frontmatter-state.json'),
    });
    await hub.loadSkills();
    const metadata = hub.listSkillMetadata();
    expect(metadata.length).toBeGreaterThanOrEqual(13);
    for (const entry of metadata) {
      expect(entry.description).not.toBe('|');
      expect(entry.description).not.toBe('>');
      expect(entry.description.length).toBeGreaterThan(20);
    }
  });

  it('extracts the trigger keywords that live inside the description block', async () => {
    const hub = new SkillHub({
      skillsDirectory: skillsDir,
      stateFile: join(tmpdir(), 'skill-hub-frontmatter-state.json'),
    });
    await hub.loadSkills();
    const content = hub.listSkillMetadata().find((entry) => entry.id === 'longbridge-content');
    expect(content).toBeDefined();
    expect(content!.keywords).toContain('新闻');
  });
});
