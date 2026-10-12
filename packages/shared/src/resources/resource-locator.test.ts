import { afterEach, describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';
import {
  getPiCwd,
  getPiExtensionEntry,
  getLangSmithExtensionEntry,
  getRuntimeRoot,
  getSkillsDir,
  isPackaged,
} from './resource-locator.ts';

const PACKAGED = 'FINAGENT_PACKAGED';
const saved = process.env[PACKAGED];
const savedResourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath');

afterEach(() => {
  if (savedResourcesPath) {
    Object.defineProperty(process, 'resourcesPath', savedResourcesPath);
  } else {
    Reflect.deleteProperty(process, 'resourcesPath');
  }
  if (saved === undefined) {
    delete process.env[PACKAGED];
  } else {
    process.env[PACKAGED] = saved;
  }
});

describe('ResourceLocator (packaged mode)', () => {
  for (const directory of ['resources', 'Resources']) {
    it(`resolves bundled skills and extensions from ${directory}`, () => {
      const root = resolve('test-package', directory);
      Object.defineProperty(process, 'resourcesPath', { value: root, configurable: true });
      process.env[PACKAGED] = '1';

      expect(isPackaged()).toBe(true);
      expect(getRuntimeRoot()).toBe(root);
      expect(getSkillsDir()).toBe(resolve(root, 'skills'));
      expect(getPiCwd()).toBe(root);
      expect(getPiExtensionEntry()).toBe(resolve(root, 'extensions', 'finagent', 'index.js'));
      expect(getLangSmithExtensionEntry()).toBe(resolve(root, 'extensions', 'langsmith', 'index.js'));
    });
  }

  it('requires the app.isPackaged flag even when Electron has a resources directory', () => {
    Object.defineProperty(process, 'resourcesPath', {
      value: resolve('electron-dev', 'resources'), configurable: true,
    });
    delete process.env[PACKAGED];
    expect(isPackaged()).toBe(false);
    expect(getPiExtensionEntry()).toBe(resolve(getRuntimeRoot(), '.pi', 'extensions', 'finagent', 'index.ts'));
  });

  it('rejects unrelated directory names that merely end with Resources', () => {
    Object.defineProperty(process, 'resourcesPath', {
      value: resolve('test-package', 'NotResources'), configurable: true,
    });
    process.env[PACKAGED] = '1';
    expect(isPackaged()).toBe(false);
  });
});

describe('ResourceLocator (dev mode)', () => {
  it('resolves the repo root from import.meta.url, not process.cwd()', () => {
    delete process.env[PACKAGED];
    // Bun tests run under the repo root; the module must not depend on it.
    const root = getRuntimeRoot();
    expect(getSkillsDir()).toBe(resolve(root, 'skills'));
    expect(getPiCwd()).toBe(root);
  });

  it('resolves the dev Pi extension entry to the source .ts file', () => {
    delete process.env[PACKAGED];
    expect(getPiExtensionEntry()).toBe(resolve(getRuntimeRoot(), '.pi', 'extensions', 'finagent', 'index.ts'));
  });

  it('does not report packaged without a real resourcesPath (non-Electron env)', () => {
    process.env[PACKAGED] = '1';
    // No process.resourcesPath in a bare Node/Bun process -> still dev.
    expect(isPackaged()).toBe(false);
  });
});
