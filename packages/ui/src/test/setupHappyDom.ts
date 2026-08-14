import { Window } from 'happy-dom';

/**
 * Shared happy-dom v20 test environment helper.
 *
 * happy-dom v20 removed `@happy-dom/global-registrator`; instead we construct
 * a `Window` and install a curated surface onto `globalThis` for the duration
 * of a test file. `restore()` deletes every installed key so pure-function
 * tests in the same bun process (one process per `bun test` run) are
 * unaffected. Pair with `beforeAll(install)` / `afterAll(restore)`.
 */

export interface HappyDomInstall {
  window: Window;
  restore: () => void;
}

const GLOBAL_KEYS = [
  'window',
  'document',
  'navigator',
  'location',
  'history',
  'localStorage',
  'sessionStorage',
  'Node',
  'Element',
  'HTMLElement',
  'SVGElement',
  'Document',
  'DocumentFragment',
  'Text',
  'Comment',
  'Event',
  'EventTarget',
  'MouseEvent',
  'KeyboardEvent',
  'FocusEvent',
  'UIEvent',
  'InputEvent',
  'PointerEvent',
  'WheelEvent',
  'CustomEvent',
  'MutationObserver',
] as const;

const BOUND_METHODS = ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'] as const;

export function installHappyDom(url = 'http://localhost/'): HappyDomInstall {
  const domWindow = new Window({ url });
  const windowRecord = domWindow as unknown as Record<string, unknown>;
  const target = globalThis as Record<string, unknown>;

  const globals: Record<string, unknown> = {};
  for (const key of GLOBAL_KEYS) {
    const value = windowRecord[key];
    if (value !== undefined) globals[key] = value;
  }
  for (const key of BOUND_METHODS) {
    const fn = windowRecord[key];
    if (typeof fn === 'function') {
      globals[key] = (fn as (...args: unknown[]) => unknown).bind(domWindow);
    }
  }

  const installedKeys: string[] = [];
  for (const key of Object.keys(globals)) {
    target[key] = globals[key];
    installedKeys.push(key);
  }
  target.IS_REACT_ACT_ENVIRONMENT = true;

  return {
    window: domWindow,
    restore() {
      for (const key of installedKeys) {
        delete target[key];
      }
      delete target.IS_REACT_ACT_ENVIRONMENT;
    },
  };
}
