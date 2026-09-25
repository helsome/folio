import { describe, it, expect } from 'bun:test';
import {
  assertKeyParity,
  checkKeyParity,
  flattenLocale,
  interpolationVars,
  resources,
} from './resources.ts';

describe('translation resources (spec §7–9, §81–82)', () => {
  it('registers exactly the two supported locales', () => {
    expect(Object.keys(resources).sort()).toEqual(['en-US', 'zh-CN']);
    expect(Object.keys(resources['en-US']).sort()).toEqual(Object.keys(resources['zh-CN']).sort());
  });

  it('flattens nested groups into dotted keys', () => {
    const flat = flattenLocale('en-US');
    expect(flat['settings.language']).toBe('Language');
    expect(flat['settings.sections.application']).toBe('Application');
  });

  it('has 100% key parity between locales', () => {
    const issues = checkKeyParity();
    expect(issues).toEqual([]);
    for (const [ns, table] of Object.entries(resources['en-US'])) {
      for (const key of Object.keys(table)) {
        expect(resources['zh-CN'][ns]).toHaveProperty(key);
      }
    }
  });

  it('throws on broken parity (missing zh key / mismatched interpolation)', () => {
    // Simulate a zh-CN missing key by temporarily removing one.
    const zhNav = resources['zh-CN'].navigation as Record<string, string>;
    const before = zhNav['today'];
    delete zhNav['today'];
    expect(() => assertKeyParity()).toThrow(/I18N_KEY_PARITY/);
    zhNav['today'] = before;
    expect(() => assertKeyParity()).not.toThrow();
  });

  it('reports one issue per key difference, on the locale that has the gap', () => {
    // en-US has `navigation.today`, zh-CN does not → the pair is a single
    // difference. `i18n:check` counts `issues.length` and prints `N issue(s)`,
    // so a mirrored report makes CI claim two problems where there is one.
    const zhNav = resources['zh-CN'].navigation as Record<string, string>;
    const before = zhNav['today'];
    delete zhNav['today'];
    try {
      const issues = checkKeyParity();
      const forToday = issues.filter((issue) => issue.key === 'navigation.today');
      expect(forToday).toHaveLength(1);
      expect(forToday[0].type).toBe('missing');
      expect(forToday[0].locale).toBe('zh-CN');
    } finally {
      zhNav['today'] = before;
    }
    expect(checkKeyParity()).toEqual([]);
  });

  it('reports a key only zh-CN defines as an extra on zh-CN', () => {
    const zhNav = resources['zh-CN'].navigation as Record<string, string>;
    zhNav['__parity_probe__'] = '探针';
    try {
      const issues = checkKeyParity();
      const probe = issues.filter((issue) => issue.key === 'navigation.__parity_probe__');
      expect(probe).toHaveLength(1);
      expect(probe[0].type).toBe('extra');
      // The key exists here and not in en-US, so the label must name zh-CN —
      // reporting it as an en-US extra states the opposite of the fact.
      expect(probe[0].locale).toBe('zh-CN');
    } finally {
      delete zhNav['__parity_probe__'];
    }
    expect(checkKeyParity()).toEqual([]);
  });

  it('reports an interpolation mismatch once, not once per direction', () => {
    const zhAutomation = resources['zh-CN'].automation as unknown as {
      run: Record<string, string>;
    };
    const before = zhAutomation.run['lastRun'];
    zhAutomation.run['lastRun'] = '无占位符';
    try {
      const issues = checkKeyParity();
      const mismatches = issues.filter((issue) => issue.key === 'automation.run.lastRun');
      expect(mismatches).toHaveLength(1);
      expect(mismatches[0].type).toBe('interpolation-mismatch');
      expect(mismatches[0].locale).toBe('zh-CN');
    } finally {
      zhAutomation.run['lastRun'] = before;
    }
    expect(checkKeyParity()).toEqual([]);
  });

  it('detects interpolation variable mismatches across locales', () => {
    const enFlat = flattenLocale('en-US');
    const zhFlat = flattenLocale('zh-CN');
    for (const key of Object.keys(enFlat)) {
      const enVars = interpolationVars(enFlat[key] as string);
      const zhVars = interpolationVars(zhFlat[key] as string);
      if (enVars.length || zhVars.length) {
        // Set semantics: translated word order differs by language, so compare
        // placeholder names (not position).
        expect([...zhVars].sort()).toEqual([...enVars].sort());
      }
    }
  });
});
