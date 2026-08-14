import { atom } from 'jotai';
import type { SkillReadiness, SkillReadinessStatus } from '@finagent/core';
import { unwrapIpcResult } from '../client/unwrap';

/**
 * Skill readiness view state.
 *
 * Readiness is computed in the main process (capability registry × skill
 * requirement map) and exposed to the UI over IPC. The channel
 * (`window.electronAPI.skills.readiness()`) is not wired yet, so the loader
 * degrades to an empty list until the Lead adds it — the Skills view then
 * renders the graceful "unavailable" state.
 */

/** Per-skill readiness snapshot, keyed by skill id. */
export const skillReadinessAtom = atom<SkillReadiness[]>([]);

/** Minimal shape of the electron API surface we consume. */
interface SkillReadinessElectronApi {
  skills?: {
    readiness?: () => Promise<unknown>;
  };
}

/**
 * Load readiness from the main process. Returns [] (graceful) when the IPC
 * channel is absent or fails, so the UI never crashes before wiring.
 */
export async function loadSkillReadiness(): Promise<SkillReadiness[]> {
  try {
    const api = (window as { electronAPI?: SkillReadinessElectronApi }).electronAPI;
    const loader = api?.skills?.readiness;
    if (typeof loader !== 'function') return [];
    const result = await loader();
    return unwrapIpcResult<SkillReadiness[]>(result) ?? [];
  } catch {
    return [];
  }
}

/** Visual presentation of a readiness status (pure — unit-tested). */
export interface ReadinessVisual {
  tone: 'ready' | 'partial' | 'unavailable';
  /** Status glyph: green ●, amber ◐, gray ○. */
  icon: string;
  color: string;
  label: string;
}

/** Map a readiness status to its badge presentation. Undefined → unavailable. */
export function readinessVisual(status?: SkillReadinessStatus): ReadinessVisual {
  switch (status) {
    case 'ready':
      return { tone: 'ready', icon: '●', color: '#22c55e', label: 'Ready' };
    case 'partial':
      return { tone: 'partial', icon: '◐', color: '#f59e0b', label: 'Partial' };
    case 'unavailable':
    default:
      return { tone: 'unavailable', icon: '○', color: '#9ca3af', label: 'Unavailable' };
  }
}

/** Find the readiness entry for a skill id (pure selector). */
export function getSkillReadiness(
  readiness: SkillReadiness[],
  skillId: string
): SkillReadiness | undefined {
  return readiness.find((entry) => entry.skillId === skillId);
}

export type { SkillReadiness, SkillReadinessStatus } from '@finagent/core';
