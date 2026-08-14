import { writeFile } from 'node:fs/promises';
import { redact, REDACTION_POLICY } from './redact.ts';
import type { DiagnosticsBundle } from './types.ts';

/**
 * Support-bundle export (spec §36).
 *
 * Pure and Electron-free: `serializeSupportBundle` applies `redact` to every
 * string in the bundle, records whether anything was actually redacted, and
 * returns the indented JSON. `writeSupportBundle` writes it to disk — the
 * caller (kernelHost) owns `dialog.showSaveDialog`.
 */
export function serializeSupportBundle(bundle: DiagnosticsBundle): string {
  const applied = { value: false };
  const redacted = redactValue(bundle, applied) as DiagnosticsBundle;
  const payload: DiagnosticsBundle = {
    ...redacted,
    redaction: {
      policy: REDACTION_POLICY,
      applied: applied.value,
    },
  };
  return JSON.stringify(payload, null, 2);
}

export async function writeSupportBundle(
  bundle: DiagnosticsBundle,
  filePath: string
): Promise<void> {
  await writeFile(filePath, serializeSupportBundle(bundle), 'utf8');
}

function redactValue(value: unknown, applied: { value: boolean }): unknown {
  if (typeof value === 'string') {
    const out = redact(value);
    if (out !== value) applied.value = true;
    return out;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, applied));
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = redactValue(item, applied);
    }
    return result;
  }
  return value;
}
