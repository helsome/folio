import { createWriteStream } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

function configuredPort() {
  const value = process.env.FINAGENT_E2E_CDP_PORT;
  if (value == null || value === '') return null;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`FINAGENT_E2E_CDP_PORT must be an integer between 1 and 65535; received ${value}`);
  }
  return port;
}

export async function reserveCdpPort() {
  const configured = configuredPort();
  if (configured != null) return configured;

  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : null;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  if (!port) throw new Error('Could not reserve a local CDP port');
  return port;
}

export function resolveElectronBinary(appRoot, repoRoot) {
  const candidates = [
    process.env.ELECTRON_BINARY,
    tryResolve(join(appRoot, 'node_modules/electron')),
    join(repoRoot, 'node_modules/.bun/electron@39.8.9/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
  ].filter(Boolean);

  const binary = candidates.find((candidate) => {
    try {
      return require('node:fs').existsSync(candidate);
    } catch {
      return false;
    }
  });
  if (!binary) {
    throw new Error(
      `Electron binary not found. Checked: ${candidates.length > 0 ? candidates.join(', ') : '(no candidates)'}`
    );
  }
  return binary;
}

function tryResolve(packagePath) {
  try {
    return require(packagePath);
  } catch {
    return null;
  }
}

export function spawnElectron({ appRoot, repoRoot, port, userDataDir, logPath }) {
  const electronBinary = resolveElectronBinary(appRoot, repoRoot);
  const electronMain = join(appRoot, 'src/main/index.js');
  const log = createWriteStream(logPath, { flags: 'w' });
  const args = [
    electronMain,
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    '--no-sandbox',
    '--disable-gpu',
  ];
  const proc = require('node:child_process').spawn(electronBinary, args, {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      FINAGENT_AGENT_PROVIDER: 'local',
      FINAGENT_FORCE_PROD_LOAD: '1',
      FINAGENT_E2E: '1',
      FINAGENT_E2E_HIDDEN: '1',
      FINAGENT_USER_DATA_DIR: userDataDir,
    },
  });
  proc.stdout.on('data', (chunk) => log.write(chunk));
  proc.stderr.on('data', (chunk) => log.write(chunk));
  proc.on('error', (error) => log.write(`\n[harness spawn error] ${error.stack ?? error}\n`));
  return { proc, log };
}

export async function waitForCdp({ url, timeoutMs, proc, logPath }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode != null || proc.signalCode != null) {
      throw new Error(formatEarlyExit(proc, logPath));
    }
    try {
      const response = await fetch(`${url}/json/version`);
      if (response.ok) return;
    } catch {
      // Electron is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Electron CDP endpoint did not come up within ${timeoutMs}ms. ${formatProcessState(proc, logPath)}`);
}

function formatEarlyExit(proc, logPath) {
  return `Electron exited before CDP became available (code=${proc.exitCode ?? 'null'}, signal=${proc.signalCode ?? 'null'}). ${formatLogHint(logPath)}`;
}

function formatProcessState(proc, logPath) {
  return `process state: pid=${proc.pid ?? 'unknown'}, code=${proc.exitCode ?? 'null'}, signal=${proc.signalCode ?? 'null'}. ${formatLogHint(logPath)}`;
}

function formatLogHint(logPath) {
  return `Electron log: ${logPath}`;
}
