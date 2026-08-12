import type { AgentRuntime, ApiResult, ToolDefinition } from '@finagent/core';
import { JsonFileStore } from '../storage/json-file-store.ts';
import { MessageRepository } from '../storage/message-repository.ts';
import { RunRepository } from '../storage/run-repository.ts';
import { SessionRepository } from '../storage/session-repository.ts';
import { LocalRuntimeAdapter } from '../agent/local-runtime-adapter.ts';
import { PiRuntimeAdapter } from '../agent/pi-runtime-adapter.ts';
import { MarketDataService } from '../agent/market-data-service.ts';
import type { PiRpcClientOptions } from '../agent/pi-rpc-client.ts';
import { SessionManager } from './session-manager.ts';
import { RunManager } from './run-manager.ts';

export type AgentProvider = 'local' | 'pi-runtime';

export interface AgentKernelOptions {
  /** Directory for Folio session/message/run persistence. */
  storageDir: string;
  /** Directory for per-session runtime conversation files (Pi JSONL). */
  piSessionDir: string;
  provider?: AgentProvider;
  /** Explicit runtime override (tests). */
  runtime?: AgentRuntime;
  marketData?: MarketDataService;
  rpc?: PiRpcClientOptions;
  now?: () => number;
}

/**
 * Composition root of the V1 agent kernel:
 *
 *   SessionManager (persistence + lifecycle)
 *     → RunManager (run lifecycle + event broadcast)
 *       → AgentRuntime (Pi or local adapter)
 *         → Pi runtime / event stream
 */
export class AgentKernel {
  readonly sessions: SessionManager;
  readonly runs: RunManager;
  readonly runtime: AgentRuntime;
  readonly marketData: MarketDataService;

  constructor(options: AgentKernelOptions) {
    const now = options.now ?? Date.now;
    const store = new JsonFileStore(options.storageDir);
    this.marketData = options.marketData ?? new MarketDataService();
    this.sessions = new SessionManager({
      sessions: new SessionRepository(store),
      messages: new MessageRepository(store),
      runs: new RunRepository(store),
      piSessionDir: options.piSessionDir,
      now,
    });

    this.runtime = options.runtime ?? createDefaultRuntime(options, this.marketData, now);

    this.runs = new RunManager({
      sessions: this.sessions,
      runs: new RunRepository(store),
      runtime: this.runtime,
      now,
    });
  }

  getTools(): Promise<ApiResult<ToolDefinition[]>> {
    return this.runtime.getTools();
  }

  async dispose(): Promise<void> {
    await this.runtime.dispose();
  }
}

function createDefaultRuntime(
  options: AgentKernelOptions,
  marketData: MarketDataService,
  now: () => number
): AgentRuntime {
  if (options.provider === 'local') {
    return new LocalRuntimeAdapter({ marketData, now });
  }
  return new PiRuntimeAdapter({
    marketData,
    sessionDir: options.piSessionDir,
    rpc: options.rpc,
    now,
  });
}
