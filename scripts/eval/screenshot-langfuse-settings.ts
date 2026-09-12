#!/usr/bin/env bun
// Capture Settings → Evaluation Langfuse cards for the PR (issue #14).
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const electronModules = join(repo, 'apps/electron/node_modules');
const previewRoot = join(here, 'langfuse-ui');
const outDir = join(repo, 'docs/assets');
const port = 43147;

async function load<T>(specifier: string): Promise<T> {
  const url = pathToFileURL(join(electronModules, specifier)).href;
  return (await import(url)) as T;
}

const { createServer } = await load<{ createServer: typeof import('vite').createServer }>('vite/dist/node/index.js');
const reactMod = await load<{ default: typeof import('@vitejs/plugin-react').default }>('@vitejs/plugin-react/dist/index.mjs');
const tailwindMod = await load<{ default: typeof import('@tailwindcss/vite').default }>('@tailwindcss/vite/dist/index.mjs');
const { chromium } = await load<{ chromium: typeof import('playwright-core').chromium }>('playwright-core/index.mjs');
const react = reactMod.default;
const tailwindcss = tailwindMod.default;

async function findBrowser(): Promise<string | undefined> {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    try {
      const file = Bun.file(candidate);
      if (await file.exists()) return candidate;
    } catch {
      // keep looking
    }
  }
  return undefined;
}

const server = await createServer({
  configFile: false,
  root: previewRoot,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      react: join(electronModules, 'react'),
      'react/jsx-runtime': join(electronModules, 'react/jsx-runtime.js'),
      'react/jsx-dev-runtime': join(electronModules, 'react/jsx-dev-runtime.js'),
      'react-dom': join(electronModules, 'react-dom'),
      'react-dom/client': join(electronModules, 'react-dom/client.js'),
      '@finagent/ui': join(repo, 'packages/ui/src'),
      '@finagent/core': join(repo, 'packages/core/src'),
      '@finagent/shared': join(repo, 'packages/shared/src'),
      '@finagent/i18n': join(repo, 'packages/i18n/src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  server: {
    host: '127.0.0.1',
    port,
    strictPort: true,
    fs: { allow: [repo] },
  },
  optimizeDeps: {
    include: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client'],
    exclude: ['@finagent/*'],
  },
});
await server.listen();

const executablePath = await findBrowser();
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
} catch (error) {
  await server.close();
  throw new Error(
    `Could not launch Chromium for UI screenshots (${error instanceof Error ? error.message : String(error)}).`
  );
}

try {
  await mkdir(outDir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="langfuse-settings"]');
  await page.screenshot({
    path: join(outDir, 'langfuse-settings-full.png'),
    fullPage: true,
  });
  const connected = page.locator('[data-preview="langfuse-connected"] [data-testid="langfuse-settings"]');
  await connected.screenshot({ path: join(outDir, 'langfuse-settings-connected.png') });
  const empty = page.locator('[data-preview="langfuse-empty"] [data-testid="langfuse-settings"]');
  await empty.screenshot({ path: join(outDir, 'langfuse-settings-empty.png') });
  console.log(`Wrote ${join(outDir, 'langfuse-settings-connected.png')}`);
  console.log(`Wrote ${join(outDir, 'langfuse-settings-empty.png')}`);
  console.log(`Wrote ${join(outDir, 'langfuse-settings-full.png')}`);
} finally {
  await browser.close();
  await server.close();
}
