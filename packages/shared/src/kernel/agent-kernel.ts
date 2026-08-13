import type { AgentRuntime, ApiResult, ToolDefinition } from '@finagent/core';
import type { SkillHub } from '@finagent/skill-hub';
import { JsonFileStore } from '../storage/json-file-store.ts';
import { MessageRepository } from '../storage/message-repository.ts';
import { RunRepository } from '../storage/run-repository.ts';
import { SessionRepository } from '../storage/session-repository.ts';
import { LocalRuntimeAdapter } from '../agent/local-runtime-adapter.ts';
import { PiRuntimeAdapter, type LlmRuntimeApi } from '../agent/pi-runtime-adapter.ts';
import { MarketDataService } from '../agent/market-data-service.ts';
import { createCodeError } from '../agent/errors.ts';
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
  /** Skill hub used for progressive skill loading in the runtime prompt. */
  skillHub?: SkillHub;
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

  /** LLM control surface when the runtime is the Pi adapter; undefined in local mode. */
  getLlmApi(): LlmRuntimeApi | undefined {
    if (this.runtime instanceof PiRuntimeAdapter) {
      return this.runtime.getLlmApi();
    }
    return undefined;
  }

  /**
   * Delete a session and its persisted data, then dispose the corresponding
   * runtime session (e.g. remove the Pi conversation file). Rejects while a
   * run is active in the session so a run never lands in a deleted session.
   */
  async deleteSession(sessionId: string): Promise<void> {
    if (this.runs.hasActiveRun(sessionId)) {
      throw createCodeError(
        'RUN_IN_PROGRESS',
        'A run is active in this session. Stop it before deleting the session.'
      );
    }
    await this.sessions.deleteSession(sessionId);
    await this.runtime.disposeSession?.(sessionId);
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
    skillHub: options.skillHub,
    now,
  });
}
