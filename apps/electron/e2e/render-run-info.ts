/**
 * Render the real Run Info view (#21) from the live-acceptance artifacts.
 *
 * Uses the shipped components — `ManifestView` and `DiffView` from
 * `packages/ui/src/components/kernel/RunInfoPanel.tsx` — so the artifact is the
 * view the app actually shows, not a re-implementation. Styling comes from the
 * repository's own design tokens, parsed out of the renderer stylesheet, so the
 * colors are the app's, not invented.
 *
 * Usage (after `run-manifest-acceptance.ts` has written its artifacts):
 *   bun apps/electron/e2e/render-run-info.ts
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RunManifest, RunManifestDiff } from '@finagent/core';
import { DiffView, ManifestView } from '../../../packages/ui/src/components/kernel/RunInfoPanel';

const repoRoot = resolve(import.meta.dir, '../../..');
const dir = resolve(
  process.env.FINAGENT_MANIFEST_OUTPUT ?? join(repoRoot, 'apps/electron/e2e/artifacts/run-manifest-acceptance')
);

const read = async (name: string) => JSON.parse(await readFile(join(dir, name), 'utf8'));

/** Pull the light-theme design tokens straight out of the renderer stylesheet. */
async function designTokens(): Promise<Record<string, string>> {
  const css = await readFile(
    join(repoRoot, 'apps/electron/src/renderer/styles/index.css'),
    'utf8'
  );
  const root = /:root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
  const tokens: Record<string, string> = {};
  for (const [, name, value] of root.matchAll(/--([a-z-]+):\s*([^;]+);/g)) {
    tokens[name] = value.trim();
  }
  return tokens;
}

function shell(title: string, tokens: Record<string, string>, body: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${title}</title>
<!-- Tailwind is loaded from the CDN purely so the shipped components' utility
     classes resolve when this artifact is opened outside the app. The color
     values below are the repository's own design tokens. -->
<script src="https://cdn.tailwindcss.com"></script>
<script>
tailwind.config = { theme: { extend: { colors: {
  accent: '${tokens.accent}',
  foreground: '${tokens.foreground}',
  border: '${tokens.border}',
  'text-muted': '${tokens['foreground-muted']}',
} } } };
</script>
<style>
  body { background:${tokens.background}; color:${tokens.foreground};
         font-family:"Inter","PingFang SC","Microsoft YaHei",system-ui,sans-serif; }
  .wb-card { background:${tokens.surface}; border:1px solid ${tokens.border};
             border-radius:6px; padding:16px; margin-bottom:16px; }
  .wb-head { font-size:13px; font-weight:600; margin-bottom:10px; }
  .wb-sub { font-size:11px; color:${tokens['foreground-muted']}; margin-bottom:12px; }
</style>
</head>
<body style="padding:24px;max-width:960px;margin:0 auto">
${body}
</body>
</html>
`;
}

const tokens = await designTokens();
const manifestA = (await read('run-a-manifest.json')) as RunManifest;
const manifestB = (await read('run-b-manifest.json')) as RunManifest;
const diff = (await read('manifest-diff.json')) as RunManifestDiff;
const restart = await read('run-info-after-restart.json');
const restartManifest = restart.manifest as RunManifest;

const card = (head: string, sub: string, node: React.ReactElement) =>
  React.createElement(
    'div',
    { className: 'wb-card' },
    React.createElement('div', { className: 'wb-head' }, head),
    React.createElement('div', { className: 'wb-sub' }, sub),
    node
  );

// 1. Run Info for the historical run, read back in a fresh process.
const afterRestart = renderToStaticMarkup(
  React.createElement(
    'div',
    null,
    React.createElement(
      'h1',
      { style: { fontSize: 18, fontWeight: 600, marginBottom: 6 } },
      'Run Info — 应用重启后读取历史 run（#21）'
    ),
    React.createElement(
      'p',
      { style: { fontSize: 12, marginBottom: 16, color: tokens['foreground-muted'] } },
      `读取进程的「当前全局设置」model = ${restart.currentGlobalModel}；` +
        `历史 run 的 manifest model = ${restartManifest.model}（仍为诞生时的配置）。`
    ),
    card(
      `Run A · ${manifestA.runId}`,
      'Run Info 视图（ManifestView）— 重启后读到的仍是该 run 自己的 manifest',
      React.createElement(ManifestView, { manifest: restartManifest })
    )
  )
);
await writeFile(join(dir, 'run-info-after-restart.html'), shell('Run Info — 重启后', tokens, afterRestart));

// 2. Both runs side by side, plus the diff the compare view shows.
const compare = renderToStaticMarkup(
  React.createElement(
    'div',
    null,
    React.createElement(
      'h1',
      { style: { fontSize: 18, fontWeight: 600, marginBottom: 6 } },
      '两次真实 Deep Research run 的 manifest 与 diff（#21）'
    ),
    React.createElement(
      'p',
      { style: { fontSize: 12, marginBottom: 16, color: tokens['foreground-muted'] } },
      '刻意改动 model 与预算（#17）；diff 应精确只反映这两处变化，prompt 未变则不报差异。'
    ),
    card(`Run A · ${manifestA.runId}`, `model = ${manifestA.model}`, React.createElement(ManifestView, { manifest: manifestA })),
    card(`Run B · ${manifestB.runId}`, `model = ${manifestB.model}`, React.createElement(ManifestView, { manifest: manifestB })),
    card(
      'Run 对比（DiffView）',
      `${diff.fields.length} 处差异 · groups=${JSON.stringify(diff.groups)}`,
      React.createElement(DiffView, { diff })
    )
  )
);
await writeFile(join(dir, 'run-info-compare.html'), shell('Run 对比', tokens, compare));

// 3. Plain-text rendering, for the report and for grep-ability.
const text = [
  'Run Info — Run A (read back in a fresh process after "restart")',
  `  runtime mode : ${restartManifest.runtimeMode}`,
  `  provider     : ${restartManifest.provider}`,
  `  model        : ${restartManifest.model}`,
  `  strategy     : ${restartManifest.strategy?.id} @ ${restartManifest.strategy?.version}`,
  `  prompt       : ${restartManifest.prompt?.version} (${restartManifest.prompt?.hash})`,
  `  tools        : ${restartManifest.tools.map((tool) => tool.name).join(', ')}`,
  `  budget       : effective=${JSON.stringify(restartManifest.budget?.effective)}`,
  `  app version  : ${restartManifest.appVersion}`,
  `  git revision : ${restartManifest.gitRevision}`,
  `  current globals in the reading process: model = ${restart.currentGlobalModel}`,
  '',
  'Two-run diff',
  ...diff.fields.map((field) => `  ${field.path}: ${JSON.stringify(field.before)} -> ${JSON.stringify(field.after)}`),
  '',
  `changed=${diff.changed} groups=${JSON.stringify(diff.groups)}`,
].join('\n');
await writeFile(join(dir, 'run-info.txt'), text);

console.log('Wrote run-info-after-restart.html, run-info-compare.html, run-info.txt');
console.log(text);
