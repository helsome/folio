import { createHash } from 'node:crypto';
import type {
  Run,
  RunManifest,
  RunManifestBudget,
  RunManifestContext,
  RunManifestDiff,
  RunManifestFeatureFlags,
  RunManifestFieldDiff,
  RunManifestModelParams,
  RunManifestSearch,
  RunManifestStrategy,
  RunManifestTool,
} from '@finagent/core';

/**
 * Snapshot a run's configuration into an immutable manifest.
 *
 * `context` is assembled by the caller (the main-process host) from the live
 * runtime + settings; `run` supplies the identity anchors. The manifest is a
 * plain data object — the caller persists it and must never overwrite it with
 * later global settings (#21 immutability requirement).
 */
export function captureRunManifest(run: Run, context: RunManifestContext): RunManifest {
  return {
    schemaVersion: 1,
    runId: run.id,
    createdAt: run.startedAt,
    runtimeMode: context.runtimeMode,
    appVersion: context.appVersion,
    buildVersion: context.buildVersion,
    gitRevision: context.gitRevision,
    provider: context.provider,
    model: context.model,
    modelParams: context.modelParams,
    prompt: context.prompt,
    strategy: context.strategy,
    tools: (context.tools ?? []).map((tool) => ({ ...tool })),
    search: context.search,
    featureFlags: context.featureFlags,
    budget: context.budget,
    locale: context.locale,
    evaluation: context.evaluation,
  };
}

/** Keys whose values are treated as secrets and stripped from a manifest. */
const SECRET_KEY_PATTERN = /(api[_-]?key|apikey|secret|token|password|passwd|private[_-]?key|credential|authorization|auth)/i;

/**
 * Defensive redaction: recursively walk a manifest and replace the *values*
 * of any secret-shaped keys with `[redacted]`. A manifest must never contain
 * credentials (#21, #19); this is a safety net so a future caller bug cannot
 * leak a key through the JSON export or the IPC surface.
 *
 * Only values are replaced — the key names are preserved so the structure
 * stays self-describing and the diff/export paths are stable.
 */
export function redactManifestSecrets<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => redactManifestSecrets(entry)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(key) && child !== null && child !== undefined && child !== '') {
        out[key] = '[redacted]';
      } else {
        out[key] = redactManifestSecrets(child);
      }
    }
    return out as unknown as T;
  }
  return value;
}

/** Stable hash of a string (used for the prompt/composition fingerprint). */
export function hashManifestInput(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Compare two manifests and report which config dimensions changed.
 *
 * Identity anchors (`runId`, `createdAt`, `schemaVersion`) are excluded — they
 * always differ between two runs and are not "configuration". The `tools`
 * array is compared element-wise by tool name so a toggled/added/removed tool
 * or a version bump shows as a precise `tools.<name>.<field>` diff.
 */
export function diffRunManifests(before: RunManifest, after: RunManifest): RunManifestDiff {
  const left = collectLeaves(before, '');
  const right = collectLeaves(after, '');
  const paths = new Set([...left.keys(), ...right.keys()]);
  const ignored = new Set(['runId', 'createdAt', 'schemaVersion']);

  const fields: RunManifestFieldDiff[] = [];
  const groups = { model: false, prompt: false, tools: false, config: false, versions: false };

  for (const path of [...paths].sort()) {
    if (ignored.has(path)) continue;
    const a = left.get(path);
    const b = right.get(path);
    if (deepEqual(a, b)) continue;
    fields.push({ path, before: a, after: b });
    classify(path, groups);
  }

  return { changed: fields.length > 0, fields, groups };
}

/** Pretty-printed, secret-redacted JSON for export / Run Info view. */
export function exportRunManifest(manifest: RunManifest): string {
  return JSON.stringify(redactManifestSecrets(manifest), null, 2);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const IDENTITY_ANCHORS = new Set(['runId', 'createdAt', 'schemaVersion']);

function collectLeaves(value: unknown, prefix: string, out: Map<string, unknown> = new Map()): Map<string, unknown> {
  if (IDENTITY_ANCHORS.has(prefix)) {
    out.set(prefix, value);
    return out;
  }
  if (Array.isArray(value)) {
    // Only `tools` is an array in the manifest; compare by tool name.
    if (prefix === 'tools' || prefix.endsWith('.tools')) {
      for (const item of value as RunManifestTool[]) {
        const key = typeof item?.name === 'string' ? item.name : '?';
        collectLeaves(item, `${prefix}.${key}`, out);
      }
      return out;
    }
    out.set(prefix, value);
    return out;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      collectLeaves(child, prefix ? `${prefix}.${key}` : key, out);
    }
    return out;
  }
  out.set(prefix, value);
  return out;
}

function classify(path: string, groups: RunManifestDiff['groups']): void {
  if (path === 'provider' || path === 'model' || path.startsWith('modelParams')) {
    groups.model = true;
  }
  if (path.startsWith('prompt')) {
    groups.prompt = true;
  }
  if (path.startsWith('tools')) {
    groups.tools = true;
  }
  if (path.startsWith('search') || path.startsWith('featureFlags') || path.startsWith('budget') || path === 'runtimeMode' || path === 'locale') {
    groups.config = true;
  }
  if (
    path === 'appVersion' ||
    path === 'buildVersion' ||
    path === 'gitRevision' ||
    path === 'prompt.version' ||
    path === 'strategy.version' ||
    path === 'strategy.id' ||
    path.endsWith('.version')
  ) {
    groups.versions = true;
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((entry, index) => deepEqual(entry, b[index]));
  }
  const aKeys = Object.keys(a as object);
  const bKeys = Object.keys(b as object);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

// Re-exported types for callers that build contexts (kept here to avoid a core import in tests).
export type {
  RunManifestBudget,
  RunManifestFeatureFlags,
  RunManifestModelParams,
  RunManifestSearch,
  RunManifestStrategy,
  RunManifestTool,
};
