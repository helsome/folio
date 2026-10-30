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
 *
 * The snapshot is **deep-copied and redacted before it is returned**:
 *
 * - The context holds references to live settings objects (`modelParams`,
 *   `search`, `budget`, …). Copying only the top level would let a later
 *   settings mutation rewrite a manifest that is supposed to be frozen, so the
 *   whole graph is cloned here.
 * - Redaction happens at capture — not just on export — so the persisted
 *   manifest and every read path (`getRunManifest` / `getResearchManifest`)
 *   are credential-free by construction, with `exportRunManifest` keeping its
 *   own pass as a second line of defence.
 */
export function captureRunManifest(run: Run, context: RunManifestContext): RunManifest {
  const manifest: RunManifest = {
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
    tools: context.tools ?? [],
    search: context.search,
    featureFlags: context.featureFlags,
    budget: context.budget,
    locale: context.locale,
    evaluation: context.evaluation,
  };
  return redactManifestSecrets(cloneManifestData(manifest));
}

/**
 * Recursively copy plain objects and arrays so a captured manifest shares no
 * mutable structure with the context it was built from.
 *
 * Deliberately not `structuredClone`: capture runs inside run creation, and a
 * non-cloneable value in a caller-supplied context must never be able to abort
 * a run. Manifest data is plain objects/arrays/primitives; anything else is
 * passed through unchanged.
 */
function cloneManifestData<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneManifestData(entry)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = cloneManifestData(child);
    }
    return out as unknown as T;
  }
  return value;
}

/** Keys whose values are treated as secrets and stripped from a manifest. */
const SECRET_KEY_PATTERN = /(api[_-]?key|apikey|secret|token|password|passwd|private[_-]?key|credential|authorization|auth)/i;

/**
 * Secret-shaped keys that are **not** credentials: token / context sizing.
 *
 * `maxTokens`, `maxOutputTokens`, `contextWindow`, `tokenBudget` … are part of
 * what a run actually obeyed, so redacting them would leave a historical
 * manifest unable to explain its own limits. A bare `token` is *not* covered —
 * it only stops being a secret when a sizing qualifier is present.
 */
const SIZING_KEY_PATTERN =
  /^(?:(?:max|min|num|total|input|output|prompt|completion|context|reasoning)[_-]?)+(?:tokens?|window|chars?|size)$|^token[_-]?(?:limit|budget|count|quota)$/i;

/**
 * Whether a key/value pair is a credential that must be stripped.
 *
 * Three things are deliberately *not* treated as secrets: known sizing knobs
 * (see `SIZING_KEY_PATTERN`), numbers and booleans — a credential is a string
 * or a nested structure, so `maxTokens: 4096` and `tokenCount: 12` survive and
 * the manifest stays reproducible.
 */
function isSecretEntry(key: string, value: unknown): boolean {
  if (!SECRET_KEY_PATTERN.test(key)) return false;
  if (typeof value === 'number' || typeof value === 'boolean') return false;
  return !SIZING_KEY_PATTERN.test(key);
}

/**
 * Defensive redaction: recursively walk a value and replace the *values* of
 * any secret-shaped keys with `[redacted]`. A manifest must never contain
 * credentials (#21, #19); it runs on capture (so the persisted snapshot is
 * already clean) and again on export / IPC read, so a caller bug cannot leak a
 * key through the JSON export or the IPC surface.
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
      if (isSecretEntry(key, child) && child !== null && child !== undefined && child !== '') {
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
