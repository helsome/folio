import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface LoadFinagentEnvOptions {
  cwd?: string;
  roots?: string[];
}

export function loadFinagentEnv(options: LoadFinagentEnvOptions = {}) {
  const shellEnv = new Set(Object.keys(process.env));
  const files = getEnvFiles(options);

  for (const file of files) {
    if (!existsSync(file)) continue;
    const values = parseEnvFile(readFileSync(file, 'utf8'));
    for (const [key, value] of Object.entries(values)) {
      if (shellEnv.has(key)) continue;
      process.env[key] = value;
    }
  }
}

function getEnvFiles(options: LoadFinagentEnvOptions) {
  const cwd = options.cwd ?? process.cwd();
  const explicitFile = process.env.FINAGENT_ENV_FILE;
  if (explicitFile) return [resolve(cwd, explicitFile)];

  const roots = unique((options.roots ?? [cwd]).map((path) => resolve(path)));

  return roots.flatMap((root) => [
    join(root, '.env'),
    join(root, '.env.local'),
  ]);
}

function parseEnvFile(contents: string) {
  const values: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const equalsIndex = line.indexOf('=');
    if (equalsIndex <= 0) continue;

    const key = line.slice(0, equalsIndex).trim();
    const value = line.slice(equalsIndex + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    values[key] = unquote(value);
  }
  return values;
}

function unquote(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}
