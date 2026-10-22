// 可移植性守卫：e2e/ 下的 harness 脚本要在 macOS / Linux / Windows 上都能跑。
// 历史上这些脚本把 Electron 二进制路径按平台写死（10 个文件指向 macOS 的
// Electron.app，citation-acceptance.mjs 指向 Windows 的 dist/electron.exe），
// 导致 `node e2e/run.mjs` 在异平台上以 "Electron binary not found" 直接退出；
// 另有 3 个脚本用 POSIX shell（rm -rf / mkdir -p）清理 userData，
// 在 Windows 的 cmd.exe 下必然抛错。此测试把这三类回归钉住。
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'bun:test';

const here = dirname(fileURLToPath(import.meta.url));
const SELF = 'platform-portability.test.ts';
const HARNESS = 'electron-harness.mjs';

function harnessScripts(): string[] {
  return readdirSync(here).filter(
    (name) => (name.endsWith('.mjs') || name.endsWith('.ts')) && name !== SELF && !name.endsWith('.test.ts'),
  );
}

const BANNED: ReadonlyArray<readonly [string, string]> = [
  ['Electron.app', 'macOS 专属 Electron bundle 路径'],
  ['node_modules/electron/dist/', '按平台写死的 electron dist 路径'],
  ['execSync(`rm -rf', 'POSIX shell 删除（Windows 的 cmd.exe 没有 rm）'],
  ['execSync(`mkdir -p', 'POSIX shell 建目录（Windows 的 cmd.exe 没有 mkdir -p）'],
];

describe('e2e harness 可移植性', () => {
  it('不依赖平台专属路径或 POSIX shell 文件操作', () => {
    const offenders: string[] = [];
    for (const name of harnessScripts()) {
      const text = readFileSync(join(here, name), 'utf8');
      for (const [pattern, why] of BANNED) {
        if (text.includes(pattern)) offenders.push(`${name}: ${why} — 命中 "${pattern}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('Electron 二进制统一由 electron-harness.mjs 的共享解析器提供', () => {
    const offenders: string[] = [];
    for (const name of harnessScripts()) {
      if (name === HARNESS) continue;
      const text = readFileSync(join(here, name), 'utf8');
      if (text.includes('function resolveElectronBinary(')) {
        offenders.push(`${name}: 重复实现 resolveElectronBinary，应改用共享解析器`);
      }
      if (text.includes('electronBinary') && !text.includes("from './electron-harness.mjs'")) {
        offenders.push(`${name}: 使用 electronBinary 但未从 ./electron-harness.mjs 导入解析器`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
