#!/usr/bin/env bun
// Run-budget smoke test (#17): a REAL provider run through the production agent
// path (AgentKernel -> RunManager -> Pi runtime), with budgets small enough that
// the run must be stopped by the guard rather than by the model finishing.
//
//   source ~/.folio-e2e.env
//   bun scripts/eval/budget-smoke.ts --prompt "..." --max-model-calls 2
//   bun scripts/eval/budget-smoke.ts --prompt "..." --loop-threshold 2 --max-tool-calls 20
//
// Exit codes: 0 = the run stopped with the expected stop reason and kept a
// partial result; 1 = it did not (or the runtime failed), so CI/agents can gate
// on real evidence instead of reading prose.
//
// Credentials: ANTHROPIC_API_KEY (or the keys Pi resolves itself). Nothing is
// printed but counts, names and the partial answer.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentEvent } from '../../packages/core/src/index.ts';
import { AgentKernel } from '../../packages/shared/src/kernel/agent-kernel.ts';

interface CliOptions {
  prompt: string;
  provider: string;
  model?: string;
  maxModelCalls?: number;
  maxToolCalls?: number;
  wallClockMs?: number;
  loopThreshold?: number;
  searchTools: string[];
  expect: string;
  timeoutMs: number;
  healthTimeoutMs: number;
  waitMs: number;
}

const USAGE = `Usage: bun scripts/eval/budget-smoke.ts [flags]

  --prompt <text>            prompt to run (required)
  --provider <id>           provider for setModel (default: anthropic)
  --model <id>              model id for setModel (default: runtime default)
  --max-model-calls <n>     model-call budget for the run
  --max-tool-calls <n>      tool-call budget for the run
  --wall-clock-ms <n>       wall-clock budget for the run
  --loop-threshold <n>      repeated identical tool calls that stop the run
  --search-tools <a,b>      tool-name patterns whose query feeds the search detector
  --expect <reason>         expected stop reason (default: any non-completed stop)
  --timeout-ms <n>          runtime request timeout (default: 120000)
  --health-timeout-ms <n>   pi startup health check budget (default: 180000; the
                            first run may download the pi runtime)
  --wait-ms <n>             how long to wait for the run to settle before
                            cancelling it (default: 600000)`;

function parseFlags(argv: string[]): CliOptions {
  const options: CliOptions = {
    prompt: '',
    provider: 'anthropic',
    searchTools: [],
    expect: '',
    timeoutMs: 120_000,
    healthTimeoutMs: 180_000,
    waitMs: 600_000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    const takeNumber = () => {
      i += 1;
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${flag} needs a positive number`);
      return parsed;
    };
    switch (flag) {
      case '--prompt':
        i += 1;
        options.prompt = value ?? '';
        break;
      case '--provider':
        i += 1;
        options.provider = value ?? 'anthropic';
        break;
      case '--model':
        i += 1;
        options.model = value;
        break;
      case '--max-model-calls':
        options.maxModelCalls = takeNumber();
        break;
      case '--max-tool-calls':
        options.maxToolCalls = takeNumber();
        break;
      case '--wall-clock-ms':
        options.wallClockMs = takeNumber();
        break;
      case '--loop-threshold':
        options.loopThreshold = takeNumber();
        break;
      case '--search-tools':
        i += 1;
        options.searchTools = (value ?? '').split(',').filter((entry) => entry !== '');
        break;
      case '--expect':
        i += 1;
        options.expect = value ?? '';
        break;
      case '--timeout-ms':
        options.timeoutMs = takeNumber();
        break;
      case '--health-timeout-ms':
        options.healthTimeoutMs = takeNumber();
        break;
      case '--wait-ms':
        options.waitMs = takeNumber();
        break;
      case '--help':
      case '-h':
        console.log(USAGE);
        process.exit(0);
        break;
      default:
        throw new Error(`unknown flag ${flag}\n\n${USAGE}`);
    }
  }
  if (options.prompt.trim() === '') throw new Error(`--prompt is required\n\n${USAGE}`);
  return options;
}

async function main(): Promise<number> {
  const options = parseFlags(process.argv.slice(2));
  if (!process.env.ANTHROPIC_API_KEY && !process.env.FINAGENT_PROVIDER_OVERRIDES) {
    console.error('no LLM credential: set ANTHROPIC_API_KEY or FINAGENT_PROVIDER_OVERRIDES');
    return 1;
  }

  const runtimeDir = await mkdtemp(join(tmpdir(), 'folio-budget-smoke-'));
  const kernel = new AgentKernel({
    provider: 'pi-runtime',
    storageDir: join(runtimeDir, 'store'),
    piSessionDir: join(runtimeDir, 'pi-sessions'),
    // Budgets are what this smoke test exists to exercise; the ceiling keeps a
    // mistyped flag from turning into a runaway real-provider bill.
    budgets: {
      defaults: {
        modelCalls: options.maxModelCalls,
        toolCalls: options.maxToolCalls,
        wallClockMs: options.wallClockMs,
      },
      ceiling: { modelCalls: 25, toolCalls: 25, wallClockMs: 15 * 60_000 },
    },
    runaway: options.loopThreshold === undefined ? {} : { repeatedToolCallThreshold: options.loopThreshold },
    searchTools: options.searchTools,
    rpc: {
      cwd: process.cwd(),
      extensions: [],
      env: () => process.env,
      requestTimeoutMs: options.timeoutMs,
      // The first run may have to fetch the pi runtime, which takes far longer
      // than the 5s default health budget.
      healthTimeoutMs: options.healthTimeoutMs,
    },
  });

  const llm = kernel.getLlmApi();
  if (llm && options.model !== undefined) {
    const state = await llm.setModel(options.provider, options.model);
    console.log(`model: ${state.model?.provider ?? '?'}/${state.model?.id ?? '?'}`);
  }

  const toolNames: string[] = [];
  let modelCalls = 0;
  const unsubscribe = kernel.runs.subscribe((event: AgentEvent) => {
    if (event.type === 'message_completed') modelCalls += 1;
    if (event.type === 'tool_completed') {
      toolNames.push(event.payload.toolCall.toolName);
      console.log(`  tool: ${event.payload.toolCall.toolName} ${JSON.stringify(event.payload.toolCall.args).slice(0, 120)}`);
    }
  });

  const session = await kernel.sessions.createSession('budget-smoke');
  const startedAt = Date.now();
  const run = await kernel.runs.startRun(session.id, options.prompt);
  console.log(`run ${run.id} started in ${runtimeDir}`);

  const deadline = Date.now() + options.waitMs;
  while (kernel.runs.isRunning() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const waitedOut = kernel.runs.isRunning();
  if (waitedOut) {
    // Never leave a real-provider run burning: cancel before reporting.
    console.error(`wait timed out after ${options.waitMs}ms; cancelling the run`);
    await kernel.runs.cancelRun(session.id, run.id);
    const cancelDeadline = Date.now() + 30_000;
    while (kernel.runs.isRunning() && Date.now() < cancelDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  const elapsedMs = Date.now() - startedAt;
  unsubscribe();

  const persisted = await kernel.sessions.getRun(session.id, run.id);
  const messages = await kernel.sessions.listMessages(session.id);
  await kernel.dispose();

  const summary = {
    status: persisted?.status,
    stopReason: persisted?.stopReason,
    stopDetail: persisted?.stopDetail,
    modelCalls,
    toolCalls: toolNames,
    elapsedMs,
    partialAnswer: (persisted?.answer ?? '').slice(0, 400),
    persistedMessages: messages.map((message) => ({
      role: message.role,
      chars: message.content.length,
      toolCalls: message.toolCalls?.length ?? 0,
    })),
    runtimeDir,
  };
  console.log('\n=== summary ===');
  console.log(JSON.stringify(summary, null, 2));

  const stopped = persisted?.stopReason !== undefined && persisted.stopReason !== 'completed';
  const expected = options.expect === '' ? stopped : persisted?.stopReason === options.expect;
  if (persisted?.status === 'failed') {
    console.error(`FAIL: run failed: ${persisted.error?.code} ${persisted.error?.message}`);
    return 1;
  }
  if (!expected) {
    console.error(
      `FAIL: expected stop reason ${options.expect || '(any non-completed)'}, got ${String(persisted?.stopReason)}`
    );
    return 1;
  }
  // The stop reason is the contract under test. Whether any partial evidence
  // exists depends on how far the real model got before the guard fired, so it
  // is reported rather than asserted; a run that produced nothing is possible.
  const evidence = (persisted?.answer ?? '') !== '' || toolNames.length > 0;
  console.log(
    `PASS: stopped with ${String(persisted?.stopReason)} after ${modelCalls} model calls, ` +
      `${toolNames.length} tool calls, partial evidence: ${evidence ? 'yes' : 'none produced before the stop'}`
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
