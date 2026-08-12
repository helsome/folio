// Skill Hub - minimal V1: loads SKILL.md files with frontmatter from a
// directory and persists per-skill enable/disable state. Marketplace, editor,
// and community features are deliberately out of scope.

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Skill } from '@finagent/core';

export interface SkillHubConfig {
  /** Directory scanned for `<name>/SKILL.md` skills. */
  skillsDirectory: string;
  /** Persisted enable/disable state (JSON map of skillId → boolean). */
  stateFile: string;
}

interface SkillState {
  enabled: Record<string, boolean>;
}

export class SkillHub {
  private skills: Map<string, Skill> = new Map();
  private config: SkillHubConfig;

  constructor(config: Partial<SkillHubConfig> = {}) {
    this.config = {
      skillsDirectory: expandHome(config.skillsDirectory ?? '~/.finagent/skills'),
      stateFile: expandHome(config.stateFile ?? '~/.finagent/skills-state.json'),
    };
  }

  /** Scan the skills directory and (re)load every `SKILL.md`. */
  async loadSkills(): Promise<void> {
    const state = await this.loadState();
    this.skills.clear();

    const entries = await readdir(this.config.skillsDirectory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skill = await this.loadSkillFromDirectory(join(this.config.skillsDirectory, entry.name));
      if (!skill) continue;
      skill.metadata.enabled = state.enabled[skill.id] ?? true;
      this.skills.set(skill.id, skill);
    }
  }

  async registerSkill(skill: Skill): Promise<void> {
    this.skills.set(skill.id, skill);
  }

  async unregisterSkill(skillId: string): Promise<void> {
    this.skills.delete(skillId);
  }

  /** Enable/disable a skill and persist the choice. */
  async setEnabled(skillId: string, enabled: boolean): Promise<void> {
    const skill = this.skills.get(skillId);
    if (!skill) return;
    skill.metadata.enabled = enabled;
    const state = await this.loadState();
    state.enabled[skillId] = enabled;
    await this.saveState(state);
  }

  getSkill(skillId: string): Skill | undefined {
    return this.skills.get(skillId);
  }

  listSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  findSkillsByKeyword(keyword: string): Skill[] {
    return this.listSkills().filter((skill) =>
      skill.trigger.keywords.some((k) => k.toLowerCase().includes(keyword.toLowerCase()))
    );
  }

  private async loadSkillFromDirectory(directory: string): Promise<Skill | undefined> {
    const markdownPath = join(directory, 'SKILL.md');
    const contents = await readFile(markdownPath, 'utf8').catch(() => undefined);
    if (contents === undefined) return undefined;

    const parsed = parseSkillMarkdown(contents);
    const now = Date.now();
    return {
      id: parsed.id ?? basenameWithoutExtension(directory),
      name: parsed.name ?? basenameWithoutExtension(directory),
      type: 'prompt',
      trigger: { keywords: parsed.keywords },
      prompt: { system: parsed.body },
      metadata: {
        enabled: true,
        editable: false,
        createdAt: now,
        updatedAt: now,
      },
    };
  }

  private async loadState(): Promise<SkillState> {
    const contents = await readFile(this.config.stateFile, 'utf8').catch(() => undefined);
    if (!contents) return { enabled: {} };
    try {
      const parsed = JSON.parse(contents) as Partial<SkillState>;
      return { enabled: parsed.enabled ?? {} };
    } catch {
      return { enabled: {} };
    }
  }

  private async saveState(state: SkillState): Promise<void> {
    await mkdir(dirnameOf(this.config.stateFile), { recursive: true });
    await writeFile(this.config.stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  }
}

export const skillHub = new SkillHub();

// ---------------------------------------------------------------------------
// Minimal SKILL.md frontmatter parsing
// ---------------------------------------------------------------------------

interface ParsedSkillMarkdown {
  id?: string;
  name?: string;
  keywords: string[];
  body: string;
}

function parseSkillMarkdown(contents: string): ParsedSkillMarkdown {
  const lines = contents.split(/\r?\n/);
  let bodyStart = 0;
  const frontmatter: Record<string, string> = {};

  if (lines[0]?.trim() === '---') {
    let index = 1;
    while (index < lines.length && lines[index].trim() !== '---') {
      const separator = lines[index].indexOf(':');
      if (separator > 0) {
        const key = lines[index].slice(0, separator).trim().toLowerCase();
        const value = lines[index].slice(separator + 1).trim().replace(/^["']|["']$/g, '');
        if (key) frontmatter[key] = value;
      }
      index += 1;
    }
    if (index < lines.length) {
      bodyStart = index + 1;
    }
  }

  return {
    id: frontmatter.id || frontmatter.slug,
    name: frontmatter.name,
    keywords: splitKeywords(frontmatter.keywords),
    body: lines.slice(bodyStart).join('\n').trim(),
  };
}

function splitKeywords(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(',').map((keyword) => keyword.trim()).filter(Boolean);
}

function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

function basenameWithoutExtension(path: string): string {
  return resolve(path).split(/[\\/]/).pop() ?? path;
}

function dirnameOf(path: string): string {
  const parts = resolve(path).split(/[\\/]/);
  parts.pop();
  return parts.join('/') || '/';
}
