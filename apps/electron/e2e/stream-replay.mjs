// Stream Event Protocol v1 — replay 的 app 级 E2E（issue #27）。
//
// 走真实传输链路：Electron main（AgentKernelHost）→ preload（runs:stream-replay
// / agent:stream）→ renderer。与 kernel 级 E2E（stream-replay.e2e.test.ts）互补，
// 这里验证 IPC 边界上的 reconnect 契约：
//   S1. 实时通道收到的事件与 replay(runId, 0) 补发完全一致（transport parity）
//   S2. 中途"断线"（只收到前 2 条）→ 按 lastSequence 补发剩余段，拼接无缺口
//   S3. 未知 run → recoverable=false（明确不可恢复路径跨 IPC 成立）
//   S4. 非法 lastSequence → INVALID_ARGUMENT（IPC 参数校验）
//
//   node e2e/stream-replay.mjs   （需先 build:preload / build:main / vite build）

import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { reserveCdpPort, spawnElectron, waitForCdp } from './electron-harness.mjs';
import { seedLocale } from './seed-locale.mjs';

// connectOverCDP 不需要本地浏览器，但 playwright 退出时会清点其浏览器缓存
// 目录（ms-playwright），在受限环境/CI 里可能被拒。指到临时目录避免副作用。
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '0';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..');
const repoRoot = join(here, '../../..');
const userDataDir = join(appRoot, 'e2e/.user-data-stream');
// 日志进 gitignored 的 artifacts 目录（与其他 harness 用例一致）。
const logPath = join(appRoot, 'e2e/artifacts/stream-replay-electron.log');
mkdirSync(dirname(logPath), { recursive: true });

const KEEP_OPEN = process.env.FINAGENT_E2E_KEEP_OPEN === '1';

let failures = 0;
function pass(name) {
  console.log(`PASS  ${name}`);
}
function fail(name, error) {
  failures += 1;
  console.error(`FAIL  ${name}`);
  console.error(String(error?.stack ?? error).slice(0, 2000));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  for (const artifact of [
    join(appRoot, 'src/main/index.js'),
    join(appRoot, 'src/preload/index.cjs'),
    join(appRoot, 'dist/renderer/index.html'),
  ]) {
    if (!existsSync(artifact)) {
      throw new Error(`Missing build artifact: ${artifact} (run build:preload, build:main, vite build)`);
    }
  }

  // Deterministic: fresh userData, seeded locale.
  rmSync(userDataDir, { recursive: true, force: true });
  mkdirSync(userDataDir, { recursive: true });
  seedLocale(userDataDir, 'en-US');

  const port = await reserveCdpPort();
  const { proc } = spawnElectron({ appRoot, repoRoot, port, userDataDir, logPath });
  // Windows 上 stale 进程不会自动清理；结束时主动 kill。
  const cdpUrl = `http://127.0.0.1:${port}`;

  let browser;
  try {
    await waitForCdp({ url: cdpUrl, timeoutMs: 60_000, proc, logPath });
    browser = await chromium.connectOverCDP(cdpUrl, { timeout: 30_000 });
    const context = browser.contexts()[0];
    const page = await waitForPage(context, 30_000);
    await page.waitForLoadState('domcontentloaded');

    // Renderer 内安装协议事件采集器（真实 onStreamEvent 通道）。
    await page.evaluate(() => {
      window.__streamEvents = [];
      window.__unsubStream = window.electronAPI.kernel.onStreamEvent((payload) => {
        window.__streamEvents.push(payload);
      });
    });

    // 建 session + 跑一次确定性 run（unsupported 意图：无工具、不触网络）。
    const session = await page.evaluate(async () => {
      const result = await window.electronAPI.kernel.createSession('stream replay e2e');
      if (!result.ok) throw new Error(JSON.stringify(result.error));
      return result.data;
    });
    assert(session && typeof session.id === 'string', 'createSession did not return an id');

    const run = await page.evaluate(async (sessionId) => {
      const result = await window.electronAPI.kernel.startRun({
        sessionId,
        content: '你好，随便聊聊',
      });
      if (!result.ok) throw new Error(JSON.stringify(result.error));
      return result.data;
    }, session.id);
    assert(run && typeof run.id === 'string', 'startRun did not return a run id');

    // 等 run 终结（run_completed / cancelled / error 任一）。
    await page.waitForFunction(
      (runId) => {
        const events = window.__streamEvents ?? [];
        const mine = events.filter((e) => e.event.runId === runId);
        const last = mine[mine.length - 1];
        return Boolean(
          last && ['run_completed', 'cancelled', 'error'].includes(last.event.type)
        );
      },
      run.id,
      { timeout: 30_000 }
    );

    const live = await page.evaluate(() => (window.__streamEvents ?? []).map((e) => e.event));
    assert(live.length >= 5, `expected >= 5 live stream events, got ${live.length}`);
    const sequences = live.map((e) => e.sequence);
    assert(
      sequences.every((seq, i) => seq === i + 1),
      `live sequence not strictly 1..N: ${JSON.stringify(sequences)}`
    );

    // S1. 实时事件与 replay(runId, 0) 全量补发一致。
    try {
      const replayAll = await page.evaluate(async (input) => {
        const result = await window.electronAPI.kernel.streamReplay(input);
        if (!result.ok) throw new Error(JSON.stringify(result.error));
        return result.data;
      }, { runId: run.id, lastSequence: 0 });
      assert(replayAll.recoverable === true, 'replay(0) not recoverable');
      assert(replayAll.atEnd === true, 'replay(0) atEnd should be true after a completed run');
      assert(
        JSON.stringify(replayAll.events) === JSON.stringify(live),
        `replayed events differ from live delivery:\nlive=${JSON.stringify(live.map(e => [e.sequence, e.type]))}\nreplay=${JSON.stringify(replayAll.events.map(e => [e.sequence, e.type]))}`
      );
      pass('S1: replay(runId, 0) over IPC returns exactly the live-delivered events');
    } catch (error) {
      fail('S1: replay(runId, 0) over IPC returns exactly the live-delivered events', error);
    }

    // S2. 中途断线：客户端只收到前 2 条，按其 lastSequence 补发剩余段。
    try {
      const received = live.slice(0, 2);
      const lastSequence = received[received.length - 1].sequence;
      const tail = await page.evaluate(async (input) => {
        const result = await window.electronAPI.kernel.streamReplay(input);
        if (!result.ok) throw new Error(JSON.stringify(result.error));
        return result.data;
      }, { runId: run.id, lastSequence });
      assert(tail.recoverable === true, 'tail replay not recoverable');
      assert(tail.events.length === live.length - received.length, 'tail length mismatch');
      assert(
        JSON.stringify([...received, ...tail.events]) === JSON.stringify(live),
        'received + replayed tail does not reconstruct the full stream'
      );
      assert(tail.atEnd === true, 'tail atEnd should be true');
      pass('S2: mid-run disconnect catch-up (lastSequence) reconstructs the full stream');
    } catch (error) {
      fail('S2: mid-run disconnect catch-up (lastSequence) reconstructs the full stream', error);
    }

    // S3. 未知 run → 明确不可恢复。
    try {
      const unknown = await page.evaluate(async () => {
        return window.electronAPI.kernel.streamReplay({ runId: 'never-seen-run', lastSequence: 0 });
      });
      assert(unknown.ok === true, 'streamReplay IPC itself should succeed');
      assert(unknown.data.recoverable === false, 'unknown run must be recoverable=false');
      assert(unknown.data.events.length === 0, 'unknown run must replay nothing');
      pass('S3: unknown run reports the explicit unrecoverable path');
    } catch (error) {
      fail('S3: unknown run reports the explicit unrecoverable path', error);
    }

    // S4. 非法 lastSequence（非整数 / 负数 / 非数字）→ INVALID_ARGUMENT。
    try {
      const cursors = ['not-a-number', -1, 1.5];
      for (const lastSequence of cursors) {
        const invalid = await page.evaluate(
          async (cursor) =>
            window.electronAPI.kernel.streamReplay({ runId: 'some-run', lastSequence: cursor }),
          lastSequence
        );
        assert(invalid.ok === false, `invalid lastSequence ${lastSequence} should fail`);
        assert(
          invalid.error && invalid.error.code === 'INVALID_ARGUMENT',
          `expected INVALID_ARGUMENT for ${lastSequence}, got ${JSON.stringify(invalid.error)}`
        );
      }
      pass('S4: invalid lastSequence is rejected with INVALID_ARGUMENT');
    } catch (error) {
      fail('S4: invalid lastSequence is rejected with INVALID_ARGUMENT', error);
    }

    await page.evaluate(() => window.__unsubStream?.());
  } catch (error) {
    // 启动/装配失败：把 electron 日志尾部带出来辅助定位。
    try {
      const tail = readFileSync(logPath, 'utf8').slice(-1500);
      console.error('--- electron log tail ---\n' + tail);
    } catch {
      // log 可能不存在。
    }
    fail('harness setup', error);
  } finally {
    await browser?.close().catch(() => undefined);
    if (!KEEP_OPEN) {
      proc.kill();
    } else {
      console.log(`KEEP_OPEN CDP port ${port} — clean up yourself.`);
    }
  }

  if (failures > 0) {
    console.error(`stream-replay E2E failed: ${failures} step(s).`);
    process.exit(1);
  }
  console.log('stream-replay E2E passed.');
  process.exit(0);
}

async function waitForPage(context, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pages = context.pages();
    if (pages.length > 0) return pages[pages.length - 1];
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('No renderer page appeared in time');
}

main();
