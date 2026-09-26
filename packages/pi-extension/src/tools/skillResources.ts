// Skill resource access tools for the Pi agent runtime.
//
// The agent receives a compact skill metadata index in its system prompt and
// loads SKILL.md bodies / references on demand through these tools. Resources
// live in the ordered directories named by FINAGENT_SKILLS_DIRS (set by the
// Folio main process when spawning the runtime). FINAGENT_SKILLS_DIR remains
// as a backward-compatible single-root fallback.

import { Type } from '@sinclair/typebox';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { validateParams } from './validation.ts';

function skillsRoots(): string[] {
  const multiple = process.env.FINAGENT_SKILLS_DIRS;
  if (multiple) {
    try {
      const parsed = JSON.parse(multiple) as unknown;
      if (Array.isArray(parsed)) {
        return Array.from(new Set(
          parsed
            .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
            .map((entry) => resolve(entry))
        ));
      }
    } catch {
      // Fall through to the legacy single-root environment variable.
    }
  }
  const root = process.env.FINAGENT_SKILLS_DIR;
  return root ? [resolve(root)] : [];
}

async function findSkillRoot(skillId: string): Promise<string> {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(skillId)) {
    throw new Error(`Invalid skill id: ${skillId}`);
  }
  const roots = skillsRoots();
  if (roots.length === 0) {
    throw new Error('Skill resources are not available in this runtime.');
  }
  for (const root of roots) {
    try {
      const candidate = await realpath(join(root, skillId));
      const candidateStat = await stat(candidate);
      if (candidateStat.isDirectory()) return candidate;
    } catch {
      // Try the next configured root.
    }
  }
  throw new Error(`Skill not found: ${skillId}`);
}

/** Resolve a skill resource path, refusing anything that escapes the root. */
async function resolveSafePath(skillId: string, resourcePath: string): Promise<string> {
  if (typeof resourcePath !== 'string' || resourcePath.length === 0) {
    throw new Error('Resource path is required.');
  }
  if (resourcePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(resourcePath)) {
    throw new Error(`Absolute paths are not allowed: ${resourcePath}`);
  }
  const normalized = resourcePath.replaceAll('\\', '/');
  if (normalized.split('/').includes('..')) {
    throw new Error(`Path traversal is not allowed: ${resourcePath}`);
  }

  const skillRoot = await findSkillRoot(skillId);
  const candidate = resolve(skillRoot, normalized);
  const realCandidate = await realpath(candidate).catch(() => candidate);
  const prefix = skillRoot.endsWith(sep) ? skillRoot : `${skillRoot}${sep}`;
  if (realCandidate !== skillRoot && !realCandidate.startsWith(prefix)) {
    throw new Error(`Path escapes the skill directory: ${resourcePath}`);
  }
  const fileStat = await stat(realCandidate);
  if (!fileStat.isFile()) {
    throw new Error(`Skill resource is not a file: ${resourcePath}`);
  }
  return realCandidate;
}

export const listSkillResourcesTool = {
  name: 'list_skill_resources',
  label: 'List Skill Resources',
  description:
    'List the files (SKILL.md, references, scripts, assets) inside a skill package. Use this to discover which reference files a skill provides before reading one.',
  parameters: Type.Object({
    skill: Type.String({
      description: 'Skill id, e.g. "longbridge-market-data"',
      examples: ['longbridge-market-data'],
    }),
  }),

  async execute(_toolCallId: string, rawParams: { skill: string }, _signal: AbortSignal) {
    const params = validateParams<{ skill: string }>(
      listSkillResourcesTool.parameters,
      rawParams
    );
    const skillRoot = await findSkillRoot(params.skill);

    const out: string[] = [];
    const walk = async (directory: string) => {
      const dirents = await readdir(directory, { withFileTypes: true });
      for (const dirent of dirents) {
        const full = join(directory, dirent.name);
        if (dirent.isDirectory()) {
          await walk(full);
        } else if (dirent.isFile()) {
          out.push(relative(skillRoot, full).replaceAll(sep, '/'));
        }
      }
    };
    await walk(skillRoot);

    return {
      content: [{
        type: 'text' as const,
        text: out.sort().join('\n'),
      }],
    };
  },
};

export const readSkillResourceTool = {
  name: 'read_skill_resource',
  label: 'Read Skill Resource',
  description:
    'Read a file inside a skill package. Use SKILL.md (path "SKILL.md") to load the full skill instructions, or a reference file (e.g. "references/depth.md") for a specific subtopic. Match the skill to the user request first (the system prompt lists available skills), then load only the resources you need.',
  parameters: Type.Object({
    skill: Type.String({
      description: 'Skill id, e.g. "longbridge-market-data"',
      examples: ['longbridge-market-data'],
    }),
    path: Type.String({
      description: 'File path relative to the skill package, e.g. "SKILL.md" or "references/depth.md"',
      examples: ['SKILL.md', 'references/depth.md'],
    }),
  }),

  async execute(
    _toolCallId: string,
    rawParams: { skill: string; path: string },
    _signal: AbortSignal
  ) {
    const params = validateParams<{ skill: string; path: string }>(
      readSkillResourceTool.parameters,
      rawParams
    );
    const safePath = await resolveSafePath(params.skill, params.path);
    const contents = await readFile(safePath, 'utf8');
    const truncated = contents.length > 40_000
      ? `${contents.slice(0, 40_000)}\n\n[truncated — file is ${contents.length} chars]`
      : contents;
    return {
      content: [{
        type: 'text' as const,
        text: truncated,
      }],
    };
  },
};
