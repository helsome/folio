// Skill Hub V2: package loader for SKILL.md-based skill packages.
//
// A skill package is a directory `<skillsDirectory>/<name>/` containing:
//   SKILL.md          (required; YAML frontmatter + markdown body)
//   references/*.md   (optional; loaded on demand by the agent)
//   scripts/          (optional)
//   assets/           (optional)
//
// V1 surface (loadSkills / registerSkill / setEnabled / listSkills /
// findSkillsByKeyword) is preserved; V2 adds metadata indexing, progressive
// resource access with path safety, and keyword matching for the router.

import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
import type { Skill } from '@finagent/core';
import { parse as parseYaml } from 'yaml';

export type SkillSource = 'bundled' | 'user';

export interface SkillDirectoryConfig {
  path: string;
  source: SkillSource;
}

export interface SkillHubConfig {
  /** Legacy single directory scanned for `<name>/SKILL.md` skills. */
  skillsDirectory?: string;
  /** Ordered skill roots. Earlier roots win when ids collide. */
  skillsDirectories?: SkillDirectoryConfig[];
  /** Persisted enable/disable state (JSON map of skillId → boolean). */
  stateFile?: string;
}

interface SkillState {
  enabled: Record<string, boolean>;
}

/** Compact skill metadata used for indexing and routing. */
export interface SkillMetadata {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  source: SkillSource;
  license?: string;
  riskLevel?: string;
  requiresLogin?: boolean;
  defaultInstall?: boolean;
  requiresMcp?: boolean;
  tier?: string;
  version?: string;
  author?: string;
  location?: string;
}

/** A resource (file) inside a skill package. */
export interface SkillResource {
  skillId: string;
  /** Path relative to the skill package root, using `/` separators. */
  path: string;
  kind: 'skill' | 'reference' | 'script' | 'asset' | 'other';
  size?: number;
}

interface ParsedSkillMarkdown {
  frontmatter: Record<string, unknown>;
  body: string;
}

interface SkillDirectoryEntry {
  id: string;
  directory: string;
  source: SkillSource;
  metadata: SkillMetadata;
  markdown: string;
}

export interface SkillInstallResult {
  skillId: string;
  name: string;
  source: 'user';
}

const MAX_SKILL_FILES = 1_000;
const MAX_SKILL_BYTES = 50 * 1024 * 1024;
const SKILL_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export class SkillHub {
  private readonly entries = new Map<string, SkillDirectoryEntry>();
  private skills: Map<string, Skill> = new Map();
  private readonly directories: SkillDirectoryConfig[];
  private readonly stateFile: string;

  constructor(config: Partial<SkillHubConfig> = {}) {
    const defaultUserDirectory = join(homedir(), '.finagent', 'skills');
    this.directories = config.skillsDirectories?.map((entry) => ({
      path: resolve(entry.path),
      source: entry.source,
    })) ?? [{
      path: resolve(config.skillsDirectory ?? defaultUserDirectory),
      source: config.skillsDirectory ? 'bundled' : 'user',
    }];
    this.stateFile = config.stateFile ?? join(homedir(), '.finagent', 'skills-state.json');
  }

  get skillsDirectory(): string {
    return this.directories[0]?.path ?? join(homedir(), '.finagent', 'skills');
  }

  get skillsDirectories(): SkillDirectoryConfig[] {
    return this.directories.map((entry) => ({ ...entry }));
  }

  /** Scan the skills directory and (re)load every `SKILL.md`. */
  async loadSkills(): Promise<void> {
    this.entries.clear();
    this.skills.clear();

    const state = await this.loadState();
    for (const rootConfig of this.directories) {
      let directories: Dirent[];
      try {
        directories = await readdir(rootConfig.path, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const dirent of directories) {
        if (!dirent.isDirectory()) continue;
        const directory = join(rootConfig.path, dirent.name);
        try {
          const markdown = await readFile(join(directory, 'SKILL.md'), 'utf8');
          const parsed = parseSkillMarkdown(markdown);
          const id = String(parsed.frontmatter.id ?? parsed.frontmatter.slug ?? dirent.name);
          if (rootConfig.source === 'user' && !SKILL_ID_PATTERN.test(id)) continue;
          if (this.entries.has(id)) continue;
          const name = String(parsed.frontmatter.name ?? dirent.name);
          const description = toDescription(parsed.frontmatter);
          const keywords = [
            ...splitKeywords(parsed.frontmatter.keywords),
            ...extractTriggerKeywords(parsed.frontmatter.description),
          ];
          const metadata = toMetadata(parsed.frontmatter, rootConfig.source);
          metadata.id = id;
          metadata.keywords = keywords;
          if (!metadata.description) {
            metadata.description = firstParagraph(parsed.body);
          }

          this.entries.set(id, {
            id,
            directory,
            source: rootConfig.source,
            metadata,
            markdown,
          });
          const enabled = state.enabled[id] ?? true;
          this.skills.set(id, {
            id,
            name,
            type: 'prompt',
            trigger: { keywords },
            prompt: { system: parsed.body },
            metadata: {
              enabled,
              editable: false,
              createdAt: 0,
              updatedAt: 0,
            },
          });
        } catch {
          // Missing/invalid SKILL.md — skip this directory.
        }
      }
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
    if (skill) {
      skill.metadata.enabled = enabled;
    }
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

  /** Compact metadata for all loaded skill packages (enabled ones). */
  listSkillMetadata(): SkillMetadata[] {
    return Array.from(this.entries.values())
      .filter((entry) => this.isEnabled(entry.id))
      .map((entry) => entry.metadata);
  }

  listAllSkillMetadata(): SkillMetadata[] {
    return Array.from(this.entries.values()).map((entry) => entry.metadata);
  }

  /** Validate and atomically install a local skill package into the user root. */
  async installSkillFromDirectory(sourceDirectory: string): Promise<SkillInstallResult> {
    const userRoot = this.directories.find((entry) => entry.source === 'user')?.path;
    if (!userRoot) {
      throw new Error('User skill installation is not configured.');
    }

    const source = resolve(sourceDirectory);
    const sourceStat = await lstat(source).catch(() => undefined);
    if (!sourceStat?.isDirectory() || sourceStat.isSymbolicLink()) {
      throw new Error('Selected skill package must be a real directory.');
    }

    const markdownPath = join(source, 'SKILL.md');
    const markdown = await readFile(markdownPath, 'utf8').catch(() => undefined);
    if (!markdown) {
      throw new Error('Selected directory does not contain SKILL.md.');
    }
    const parsed = parseSkillMarkdown(markdown);
    const id = String(parsed.frontmatter.id ?? parsed.frontmatter.slug ?? basename(source));
    const name = parsed.frontmatter.name;
    if (!SKILL_ID_PATTERN.test(id)) {
      throw new Error('Skill id must use 1-64 lowercase letters, digits, or hyphens.');
    }
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new Error('SKILL.md frontmatter must define a non-empty name.');
    }
    if (toDescription(parsed.frontmatter).length === 0) {
      throw new Error('SKILL.md frontmatter must define a non-empty description.');
    }

    await validatePackageTree(source);
    await mkdir(userRoot, { recursive: true });
    const destination = join(userRoot, id);
    if (this.entries.has(id) || await pathExists(destination)) {
      throw new Error(`A skill with id "${id}" is already installed.`);
    }

    const stagingRoot = await mkdtemp(join(userRoot, '.install-'));
    const stagingSkill = join(stagingRoot, id);
    try {
      await cp(source, stagingSkill, { recursive: true, errorOnExist: true, force: false });
      await rename(stagingSkill, destination);
    } finally {
      await rm(stagingRoot, { recursive: true, force: true });
    }

    await this.loadSkills();
    const installed = this.entries.get(id);
    if (!installed || installed.source !== 'user') {
      await rm(destination, { recursive: true, force: true });
      await this.loadSkills();
      throw new Error('Installed skill could not be loaded.');
    }

    return { skillId: id, name: name.trim(), source: 'user' };
  }

  userSkillDirectory(skillId: string): string {
    const entry = this.entries.get(skillId);
    if (!entry) throw new Error(`Skill not found: ${skillId}`);
    if (entry.source !== 'user') throw new Error('Bundled skills cannot be removed.');
    return entry.directory;
  }

  isEnabled(skillId: string): boolean {
    return this.skills.get(skillId)?.metadata.enabled ?? false;
  }

  findSkillsByKeyword(keyword: string): Skill[] {
    const needle = keyword.toLowerCase();
    return this.listSkills().filter(
      (skill) =>
        skill.id.toLowerCase().includes(needle) ||
        skill.name.toLowerCase().includes(needle) ||
        skill.trigger.keywords.some((entry) => entry.toLowerCase().includes(needle))
    );
  }

  /**
   * Score enabled skills against a user query. Returns matches ordered by
   * relevance (keyword hits in name > description > trigger keywords).
   */
  matchSkills(query: string, limit = 5): SkillMetadata[] {
    const tokens = query.toLowerCase().split(/\s+/).filter((token) => token.length > 0);
    if (tokens.length === 0) return [];

    const scored = this.listSkillMetadata().map((metadata) => {
      const name = metadata.name.toLowerCase();
      const description = metadata.description.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (name.includes(token)) score += 4;
        if (description.includes(token)) score += 2;
        if (metadata.keywords.some((keyword) => keyword.toLowerCase().includes(token))) score += 1;
      }
      return { metadata, score };
    });

    return scored
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((entry) => entry.metadata);
  }

  /** Read a skill's SKILL.md body (without frontmatter). */
  async readSkillMarkdown(skillId: string): Promise<string> {
    const entry = this.requireEntry(skillId);
    return entry.markdown;
  }

  /** List all files inside a skill package. */
  async listSkillResources(skillId: string): Promise<SkillResource[]> {
    const entry = this.requireEntry(skillId);
    const resources: SkillResource[] = [];
    await this.walk(entry, entry.directory, resources);
    return resources.sort((a, b) => a.path.localeCompare(b.path));
  }

  /**
   * Read a resource inside a skill package.
   *
   * Path safety: rejects absolute paths, `..` traversal, and any path that
   * escapes the skill root (including through symlinks — verified with
   * realpath). Only regular files can be read.
   */
  async readSkillResource(skillId: string, relativePath: string): Promise<string> {
    const entry = this.requireEntry(skillId);
    const safePath = await this.resolveSafePath(entry, relativePath);
    const fileStat = await stat(safePath);
    if (!fileStat.isFile()) {
      throw new Error(`Skill resource is not a file: ${relativePath}`);
    }
    return readFile(safePath, 'utf8');
  }

  /** Verify a resource path is safe and return its real path. */
  async resolveSkillResourcePath(skillId: string, relativePath: string): Promise<string> {
    const entry = this.requireEntry(skillId);
    return this.resolveSafePath(entry, relativePath);
  }

  private requireEntry(skillId: string): SkillDirectoryEntry {
    const entry = this.entries.get(skillId);
    if (!entry) {
      throw new Error(`Skill not found: ${skillId}`);
    }
    if (!this.isEnabled(skillId)) {
      throw new Error(`Skill is disabled: ${skillId}`);
    }
    return entry;
  }

  private async resolveSafePath(entry: SkillDirectoryEntry, relativePath: string): Promise<string> {
    if (typeof relativePath !== 'string' || relativePath.length === 0) {
      throw new Error('Skill resource path is required.');
    }
    if (relativePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(relativePath)) {
      throw new Error(`Absolute paths are not allowed: ${relativePath}`);
    }
    const normalized = relativePath.replaceAll('\\', '/');
    if (normalized.split('/').includes('..')) {
      throw new Error(`Path traversal is not allowed: ${relativePath}`);
    }

    const root = await realpath(entry.directory);
    const candidate = resolve(root, normalized);
    const realCandidate = await realpath(candidate).catch(() => candidate);
    const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
    if (realCandidate !== root && !realCandidate.startsWith(prefix)) {
      throw new Error(`Path escapes the skill directory: ${relativePath}`);
    }
    return realCandidate;
  }

  private async walk(entry: SkillDirectoryEntry, directory: string, out: SkillResource[]): Promise<void> {
    let dirents;
    try {
      dirents = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of dirents) {
      const full = join(directory, dirent.name);
      if (dirent.isDirectory()) {
        await this.walk(entry, full, out);
        continue;
      }
      if (!dirent.isFile()) continue;
      const rel = relative(entry.directory, full).replaceAll(sep, '/');
      let kind: SkillResource['kind'] = 'other';
      if (rel === 'SKILL.md') kind = 'skill';
      else if (rel.startsWith('references/')) kind = 'reference';
      else if (rel.startsWith('scripts/')) kind = 'script';
      else if (rel.startsWith('assets/')) kind = 'asset';
      let size: number | undefined;
      try {
        size = (await stat(full)).size;
      } catch {
        size = undefined;
      }
      out.push({ skillId: entry.id, path: rel, kind, size });
    }
  }

  private async loadState(): Promise<SkillState> {
    try {
      const contents = await readFile(this.stateFile, 'utf8');
      const parsed = JSON.parse(contents) as Partial<SkillState>;
      return { enabled: parsed.enabled ?? {} };
    } catch {
      return { enabled: {} };
    }
  }

  private async saveState(state: SkillState): Promise<void> {
    await mkdir(resolve(this.stateFile, '..'), { recursive: true });
    await writeFile(this.stateFile, JSON.stringify(state, null, 2), 'utf8');
  }
}

async function pathExists(path: string): Promise<boolean> {
  return lstat(path).then(() => true, () => false);
}

async function validatePackageTree(root: string): Promise<void> {
  let files = 0;
  let bytes = 0;
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Skill packages cannot contain symbolic links: ${relative(root, full)}`);
      }
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`Skill packages can contain only files and directories: ${relative(root, full)}`);
      }
      files += 1;
      bytes += (await stat(full)).size;
      if (files > MAX_SKILL_FILES) {
        throw new Error(`Skill package exceeds the ${MAX_SKILL_FILES}-file limit.`);
      }
      if (bytes > MAX_SKILL_BYTES) {
        throw new Error('Skill package exceeds the 50 MB size limit.');
      }
    }
  };
  await walk(root);
}

export const skillHub = new SkillHub();

// ---------------------------------------------------------------------------
// SKILL.md frontmatter parsing
// ---------------------------------------------------------------------------

export function parseSkillMarkdown(contents: string): ParsedSkillMarkdown {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(contents);
  if (!match) {
    return { frontmatter: {}, body: contents.trim() };
  }
  const frontmatter = parseFrontmatter(match[1]);
  return { frontmatter, body: match[2]?.trim() ?? '' };
}

function parseFrontmatter(raw: string): Record<string, unknown> {
  const parsed: unknown = parseYaml(raw);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

function toDescription(frontmatter: Record<string, unknown>): string {
  const value = frontmatter.description;
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
}

function toMetadata(frontmatter: Record<string, unknown>, source: SkillSource): SkillMetadata {
  const name = String(frontmatter.name ?? '');
  const nested = (frontmatter.metadata ?? {}) as Record<string, unknown>;
  return {
    id: String(frontmatter.id ?? frontmatter.slug ?? name),
    name,
    description: toDescription(frontmatter),
    keywords: splitKeywords(frontmatter.keywords),
    source,
    license: frontmatter.license === undefined ? undefined : String(frontmatter.license),
    riskLevel: nested.risk_level === undefined ? undefined : String(nested.risk_level),
    requiresLogin: nested.requires_login === undefined ? undefined : Boolean(nested.requires_login),
    defaultInstall: nested.default_install === undefined ? undefined : Boolean(nested.default_install),
    requiresMcp: nested.requires_mcp === undefined ? undefined : Boolean(nested.requires_mcp),
    tier: nested.tier === undefined ? undefined : String(nested.tier),
    version: nested.version === undefined ? undefined : String(nested.version),
    author: nested.author === undefined ? undefined : String(nested.author),
  };
}

function firstParagraph(body: string): string {
  const paragraph = body.split(/\n\s*\n/)[0] ?? '';
  return paragraph.replace(/\s+/g, ' ').trim();
}

function splitKeywords(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** Extract quoted trigger words/phrases from a Longbridge-style description. */
function extractTriggerKeywords(description: unknown): string[] {
  if (typeof description !== 'string') return [];
  const triggers: string[] = [];
  const match = /Triggers:\s*([\s\S]*)$/i.exec(description);
  const section = match ? match[1] : '';
  for (const quoted of section.matchAll(/"([^"]+)"/g)) {
    const phrase = quoted[1].trim();
    if (phrase.length > 0) triggers.push(phrase);
  }
  return triggers;
}

export function basenameWithoutExtension(path: string): string {
  return resolve(path).split(/[\\/]/).pop() ?? path;
}

// Skill readiness: per-skill capability requirement map (see capability-map.ts).
export { skillCapabilityMap } from './capability-map.ts';
export type { CapabilityId, SkillCapabilityRequirements } from '@finagent/core';
export type { SkillReadiness, SkillReadinessStatus } from '@finagent/core';
