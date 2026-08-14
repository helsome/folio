import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'bun:test';
import {
  FIXTURES_DIR,
  assertSafeFixtureName,
  fixturePath,
  loadFixture,
  loadFixtureText,
} from './load-fixture.ts';

/** Base names of every captured JSON fixture (e.g. "depth" from "depth.json"). */
function listFixtureNames(): string[] {
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .sort();
}

function hasErrorRecord(name: string): boolean {
  const files = readdirSync(FIXTURES_DIR);
  return files.includes(`${name}.error.txt`);
}

const fixtureNames = listFixtureNames();

describe('longbridge test fixtures', () => {
  it('captures at least 12 command fixtures', () => {
    expect(fixtureNames.length).toBeGreaterThanOrEqual(12);
  });

  it('every fixture JSON parses as valid JSON', () => {
    expect(fixtureNames.length).toBeGreaterThan(0);
    for (const name of fixtureNames) {
      const raw = readFileSync(fixturePath(name), 'utf8');
      expect(
        () => JSON.parse(raw),
        `fixture ${name}.json should be valid JSON`
      ).not.toThrow();
    }
  });

  it('every non-error fixture has non-empty content', () => {
    for (const name of fixtureNames) {
      if (hasErrorRecord(name)) continue;
      const raw = loadFixtureText(name);
      expect(raw.trim().length, `fixture ${name}.json should not be empty`).toBeGreaterThan(0);

      const parsed = JSON.parse(raw);
      expect(parsed, `fixture ${name}.json should not parse to null`).not.toBeNull();
      expect(parsed, `fixture ${name}.json should not be undefined`).not.toBeUndefined();
    }
  });

  it('every fixture has a recorded invocation (.cmd.txt)', () => {
    for (const name of fixtureNames) {
      const files = readdirSync(FIXTURES_DIR);
      expect(files, `fixture ${name} should have ${name}.cmd.txt`).toContain(`${name}.cmd.txt`);
    }
  });

  it('error fixtures pair an .error.txt with no .json', () => {
    const errorFiles = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.error.txt'));
    for (const errorFile of errorFiles) {
      const name = errorFile.slice(0, -'.error.txt'.length);
      expect(fixtureNames, `${name}.error.txt should not have a sibling ${name}.json`).not.toContain(
        name
      );
    }
  });
});

describe('loadFixture', () => {
  it('loads and parses a known fixture', () => {
    const depth = loadFixture<{ symbol?: string }>('depth');
    expect(depth).toBeTruthy();
    expect(depth.symbol).toBe('NVDA.US');
  });

  it('rejects path traversal', () => {
    expect(() => assertSafeFixtureName('../secrets')).toThrow();
    expect(() => assertSafeFixtureName('..')).toThrow();
    expect(() => assertSafeFixtureName('a/b')).toThrow();
    expect(() => assertSafeFixtureName('/etc/passwd')).toThrow();
    expect(() => assertSafeFixtureName('foo\\bar')).toThrow();
    expect(() => assertSafeFixtureName('')).toThrow();
  });

  it('accepts safe names including dashes and dots', () => {
    expect(() => assertSafeFixtureName('capital-flow')).not.toThrow();
    expect(() => assertSafeFixtureName('calc-index')).not.toThrow();
  });
});
