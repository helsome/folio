#!/usr/bin/env bun
// Folio trace smoke (V7 §103-104).
//
//   bun run scripts/eval/trace-smoke.mjs
//
// Spawns the Pi runtime with the Finagent + LangSmith extensions and sends a
// minimal prompt. Verifies the runtime starts, the prompt completes, and no
// extension-load errors appear on stderr. When a LangSmith API key is
// configured it additionally queries the runs API for the resulting trace and
// asserts a run carrying metadata.thread_id == Pi session id exists.
//
// Exit codes: 0 = pass (or skipped for lack of LLM credentials), 1 = fail.

import {
  PiRpcClient,
  getLangSmithExtensionEntry,
  getPiCwd,
  getPiExtensionEntry,
} from '../../packages/shared/src/index.ts';

const langsmithApiKey = process.env.LANGSMITH_PI_API_KEY ?? process.env.LANGSMITH_API_KEY;

/** LLM credentials exist when ANTHROPIC_API_KEY or any FINAGENT_LLM_ENV_KEYS entry is set. */
function hasLlmCredential() {
  if (process.env.ANTHROPIC_API_KEY) return true;
  const keys = (process.env.FINAGENT_LLM_ENV_KEYS ?? '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
  return keys.some((key) => Boolean(process.env[key]));
}

async function queryLangSmithRuns(threadId) {
  const endpoint = (process.env.LANGSMITH_PI_ENDPOINT ?? 'https://api.smith.langchain.com').replace(/\/+$/, '');
  const startTime = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const response = await fetch(`${endpoint}/runs/query`, {
    method: 'POST',
    headers: {
      'x-api-key': langsmithApiKey,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      filters: { start_time: startTime },
      limit: 5,
      order: '-start_time',
    }),
  });
  if (!response.ok) {
    throw new Error(`runs/query failed: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
  }
  const data = await response.json();
  const runs = Array.isArray(data) ? data : Array.isArray(data?.runs) ? data.runs : [];
  const matchedThread = runs.filter((run) => run?.metadata?.thread_id === threadId).length;
  return { runs: runs.length, matchedThread };
}

async function main() {
  const errorLogs = [];
  const client = new PiRpcClient({
    extensions: [getPiExtensionEntry(), getLangSmithExtensionEntry()],
    cwd: getPiCwd(),
    // Cold `bunx` installs the Pi runtime on first run; allow generous startup.
    healthTimeoutMs: 120_000,
    requestTimeoutMs: 120_000,
    env: {
      TRACE_TO_LANGSMITH: langsmithApiKey ? 'true' : 'false',
      ...(langsmithApiKey ? { LANGSMITH_PI_API_KEY: langsmithApiKey } : {}),
      LANGSMITH_PI_PROJECT: process.env.LANGSMITH_PI_PROJECT ?? 'folio-agent',
      LANGSMITH_PI_METADATA: '{"app":"folio","purpose":"trace-smoke"}',
    },
    onLog: (log) => {
      if (log.level === 'error') errorLogs.push(log);
    },
  });

  try {
    const stateBefore = await client.getState();

    if (!hasLlmCredential()) {
      console.log('skipped: no LLM credential');
      await client.dispose();
      return 0;
    }

    const result = await client.prompt('hi');
    if (result.aborted) {
      throw new Error('prompt aborted before completing');
    }

    const stateAfter = await client.getState();
    const sessionId = stateAfter.sessionId ?? stateBefore.sessionId;

    const extensionErrors = errorLogs.filter((log) => /extension/i.test(log.message));
    if (extensionErrors.length > 0) {
      throw new Error(`extension-load errors:\n${extensionErrors.map((log) => log.message).join('\n')}`);
    }

    let counts = { runs: 0, matchedThread: 0 };
    if (langsmithApiKey) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      counts = await queryLangSmithRuns(sessionId);
      console.log(
        `trace query: ${counts.runs} runs in window, ${counts.matchedThread} with thread_id=${sessionId ?? '(none)'}`
      );
      if (counts.matchedThread === 0) {
        throw new Error(`no LangSmith run found with metadata.thread_id=${sessionId ?? '(none)'}`);
      }
    } else {
      console.log('trace query: skipped (no LANGSMITH_PI_API_KEY)');
    }

    console.log(`ok: prompt completed; session_id=${sessionId ?? '(none)'}`);
    await client.dispose();
    return 0;
  } catch (error) {
    console.error(`trace-smoke failed: ${error instanceof Error ? error.message : String(error)}`);
    await client.dispose();
    return 1;
  }
}

process.exitCode = await main();