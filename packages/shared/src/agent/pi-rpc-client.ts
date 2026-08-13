import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process';
import type { AgentTraceEvent, LlmModel, ToolCallRecord } from '@finagent/core';
import { createCodeError } from './errors.ts';
type SpawnProcess = Pick<ChildProcessWithoutNullStreams, 'stdin' | 'stdout' | 'stderr' | 'kill' | 'killed' | 'pid'> & {
  on: ChildProcessWithoutNullStreams['on'];
};

type SpawnFn = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio
) => SpawnProcess;

export interface PiRuntimeLog {
  level: 'error' | 'warn' | 'info';
  message: string;
  timestamp: number;
  data?: unknown;
}

export interface PiRpcClientOptions {
  command?: string;
  args?: string[];
  cwd?: string;
  sessionDir?: string;
  /** Static env or a provider evaluated at each spawn (credential changes). */
  env?: NodeJS.ProcessEnv | (() => NodeJS.ProcessEnv | Promise<NodeJS.ProcessEnv>);
  requestTimeoutMs?: number;
  healthTimeoutMs?: number;
  controlTimeoutMs?: number;
  singleToolTimeoutMs?: number;
  maxToolCalls?: number;
  requiredEnvKeys?: string[];
  now?: () => number;
  spawnProcess?: SpawnFn;
  onLog?: (log: PiRuntimeLog) => void;
}

export interface PiPromptResult {
  answer: string;
  toolCalls: ToolCallRecord[];
  trace: AgentTraceEvent[];
  /** True when the run ended because abort was requested. */
  aborted?: boolean;
}

/** Runtime state reported by `get_state`. */
export interface PiState {
  sessionId?: string;
  sessionFile?: string;
  sessionName?: string;
  isStreaming?: boolean;
  messageCount?: number;
  /** Active model descriptor (present on Pi 0.73+). */
  model?: LlmModel;
  /** Active thinking level (off/minimal/low/medium/high/xhigh/max). */
  thinkingLevel?: string;
}

/** Events yielded by {@link PiRpcClient.promptStreaming}. */
export type PiStreamEvent =
  | { kind: 'event'; event: Record<string, unknown> }
  | { kind: 'end'; result: PiPromptResult }
  | { kind: 'error'; error: unknown };

/** Live prompt handle: iterate to consume raw Pi events, abort to stop. */
export interface PiPromptStream {
  [Symbol.asyncIterator](): AsyncIterator<PiStreamEvent>;
  abort(): Promise<void>;
}

interface PendingPrompt {
  id: string;
  answerParts: string[];
  finalAnswer?: string;
  toolCalls: ToolCallRecord[];
  trace: AgentTraceEvent[];
  toolTimeouts: Map<string, ReturnType<typeof setTimeout>>;
  timeout: ReturnType<typeof setTimeout>;
  abortRequested: boolean;
  onEvent?: (event: Record<string, unknown>) => void;
  resolve: (result: PiPromptResult) => void;
  reject: (error: unknown) => void;
}

interface PendingControl {
  id: string;
  timeout: ReturnType<typeof setTimeout>;
  resolve: (data: unknown) => void;
  reject: (error: unknown) => void;
}

export class PiRpcClient {
  private readonly command: string;
  private readonly args: string[];
  private readonly env?: NodeJS.ProcessEnv | (() => NodeJS.ProcessEnv | Promise<NodeJS.ProcessEnv>);
  private readonly cwd?: string;
  private readonly sessionDir?: string;
  private readonly requestTimeoutMs: number;
  private readonly healthTimeoutMs: number;
  private readonly controlTimeoutMs: number;
  private readonly singleToolTimeoutMs: number;
  private readonly maxToolCalls: number;
  private readonly requiredEnvKeys: string[];
  private readonly now: () => number;
  private readonly spawnProcess: SpawnFn;
  private readonly onLog: (log: PiRuntimeLog) => void;
  private process: SpawnProcess | null = null;
  private stdoutBuffer = '';
  private stderrBuffer = '';
  private exited = false;
  private pendingPrompts = new Map<string, PendingPrompt>();
  private pendingControls = new Map<string, PendingControl>();

  constructor(options: PiRpcClientOptions = {}) {
    this.command = options.command ?? readDefaultPiCommand();
    const defaultArgs = readDefaultPiArgs();
    this.args = options.args ?? (
      options.sessionDir
        ? [...defaultArgs, '--session-dir', options.sessionDir]
        : defaultArgs
    );
    this.cwd = options.cwd ?? process.cwd();
    this.env = options.env;
    this.sessionDir = options.sessionDir;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 60_000;
    this.healthTimeoutMs = options.healthTimeoutMs ?? 5_000;
    this.controlTimeoutMs = options.controlTimeoutMs ?? 90_000;
    this.singleToolTimeoutMs = options.singleToolTimeoutMs ?? 30_000;
    this.maxToolCalls = options.maxToolCalls ?? 8;
    this.requiredEnvKeys = options.requiredEnvKeys ?? [];
    this.now = options.now ?? Date.now;
    this.spawnProcess = options.spawnProcess ?? ((command, args, spawnOptions) =>
      spawn(command, args, spawnOptions));
    this.onLog = options.onLog ?? (() => undefined);
  }

  async healthCheck(): Promise<void> {
    await this.sendControl<unknown>({ type: 'get_state' }, this.healthTimeoutMs);
  }

  /** Read the runtime's current session identity and file. */
  async getState(): Promise<PiState> {
    const data = await this.sendControl<unknown>({ type: 'get_state' }, this.healthTimeoutMs);
    return readRecord(data) as PiState;
  }

  /**
   * Switch the runtime to the given session file, creating it on first use.
   * Returns the runtime session identity for the now-active conversation.
   */
  async switchSession(sessionPath: string): Promise<PiState> {
    await this.sendControl<unknown>({ type: 'switch_session', sessionPath }, this.healthTimeoutMs);
    return this.getState();
  }

  /**
   * List models available in the runtime (auth-configured only).
   * First call can be slow while the runtime warms its model catalog.
   */
  async getAvailableModels(): Promise<LlmModel[]> {
    const data = await this.sendControl<unknown>({ type: 'get_available_models' }, this.controlTimeoutMs);
    const record = readRecord(data);
    const models = record.models;
    if (!Array.isArray(models)) {
      throw createCodeError('PI_PROTOCOL_ERROR', 'Pi get_available_models returned no models list.');
    }
    return models.map((model) => readRecord(model) as unknown as LlmModel);
  }

  /** Switch the active model. Returns the model descriptor now in effect. */
  async setModel(provider: string, modelId: string): Promise<LlmModel> {
    const data = await this.sendControl<unknown>(
      { type: 'set_model', provider, modelId },
      this.controlTimeoutMs
    );
    return readRecord(data) as unknown as LlmModel;
  }

  /** Set the thinking level. The runtime coerces to the nearest supported level. */
  async setThinkingLevel(level: string): Promise<void> {
    await this.sendControl<unknown>({ type: 'set_thinking_level', level }, this.controlTimeoutMs);
  }

  /**
   * Stop the runtime process and allow the next command to spawn a fresh one.
   * Used when provider credentials change: the extension registers providers
   * at process startup, so a new process is required to pick them up.
   */
  async restart(): Promise<void> {
    await this.dispose();
    this.exited = false;
  }


  /**
   * Abort the currently running prompt. The runtime stops streaming and the
   * active prompt stream settles as aborted.
   */
  async abortCurrentPrompt(): Promise<void> {
    const pending = this.activePrompt();
    if (!pending) return;
    if (pending.abortRequested) return;
    pending.abortRequested = true;
    try {
      await this.sendControl<unknown>({ type: 'abort' }, this.healthTimeoutMs);
    } catch {
      // Runtime may be unresponsive; force-finish the prompt below anyway.
    }
    const stillPending = this.activePrompt();
    if (stillPending) {
      this.finishPrompt(stillPending);
    }
  }

  /**
   * Send a prompt and consume raw Pi JSONL events as they arrive.
   *
   * The stream yields each parsed stdout event, then ends with `kind: 'end'`
   * carrying the aggregated result. It throws on runtime error, exit, timeout,
   * or malformed output, and never hangs: every failure path settles it.
   */
  promptStreaming(content: string): PiPromptStream {
    const spawnPromise = this.ensureStarted();
    const id = randomUUID();
    const queue: PiStreamEvent[] = [];
    const waiters: Array<(event: PiStreamEvent) => void> = [];

    const push = (event: PiStreamEvent) => {
      const waiter = waiters.shift();
      if (waiter) {
        waiter(event);
      } else {
        queue.push(event);
      }
    };

    const next = () => new Promise<PiStreamEvent>((resolve) => {
      const queued = queue.shift();
      if (queued) {
        resolve(queued);
      } else {
        waiters.push(resolve);
      }
    });

    const timeout = setTimeout(() => {
      // Settle the stream; clear per-tool timers so no late tool-timeout
      // callback fires after the stream has already terminated.
      const timedOut = this.pendingPrompts.get(id);
      this.pendingPrompts.delete(id);
      if (timedOut) {
        for (const toolTimeout of timedOut.toolTimeouts.values()) {
          clearTimeout(toolTimeout);
        }
        timedOut.toolTimeouts.clear();
      }
      push({
        kind: 'error',
        error: createCodeError('PI_REQUEST_TIMEOUT', `Pi request timed out after ${this.requestTimeoutMs}ms.`),
      });
    }, this.requestTimeoutMs);

    const pending: PendingPrompt = {
      id,
      answerParts: [],
      toolCalls: [],
      trace: [],
      toolTimeouts: new Map(),
      timeout,
      abortRequested: false,
      onEvent: (event) => push({ kind: 'event', event }),
      resolve: (result) => {
        clearTimeout(timeout);
        push({ kind: 'end', result });
      },
      reject: (error) => {
        clearTimeout(timeout);
        push({ kind: 'error', error });
      },
    };
    this.pendingPrompts.set(id, pending);
    const self = this;

    const iterator = (async function* () {
      let proc: SpawnProcess;
      try {
        proc = await spawnPromise;
      } catch (error) {
        pending.reject(error);
        throw error;
      }
      self.writeJson(proc, { type: 'prompt', id, message: content }, pending);
      while (true) {
        const event = await next();
        if (event.kind === 'error') {
          throw event.error;
        }
        if (event.kind === 'end') {
          yield event;
          return;
        }
        yield event;
      }
    })();

    return {
      [Symbol.asyncIterator]: () => iterator,
      abort: () => this.abortCurrentPrompt(),
    };
  }

  async prompt(content: string): Promise<PiPromptResult> {
    const proc = await this.ensureStarted();
    const id = randomUUID();

    return new Promise<PiPromptResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingPrompts.delete(id);
        reject(createCodeError('PI_REQUEST_TIMEOUT', `Pi request timed out after ${this.requestTimeoutMs}ms.`));
      }, this.requestTimeoutMs);

      const pending: PendingPrompt = {
        id,
        answerParts: [],
        toolCalls: [],
        trace: [],
        toolTimeouts: new Map(),
        timeout,
        abortRequested: false,
        resolve,
        reject,
      };
      this.pendingPrompts.set(id, pending);
      this.writeJson(proc, { type: 'prompt', id, message: content }, pending);
    });
  }

  async dispose(): Promise<void> {
    const proc = this.process;
    if (!proc) return;

    for (const pending of this.pendingPrompts.values()) {
      clearTimeout(pending.timeout);
      for (const timeout of pending.toolTimeouts.values()) {
        clearTimeout(timeout);
      }
      pending.toolTimeouts.clear();
      pending.reject(createCodeError('PI_RUNTIME_STOPPED', 'Pi runtime was stopped.'));
    }
    this.pendingPrompts.clear();
    for (const pending of this.pendingControls.values()) {
      clearTimeout(pending.timeout);
      pending.reject(createCodeError('PI_RUNTIME_STOPPED', 'Pi runtime was stopped.'));
    }
    this.pendingControls.clear();

    try {
      proc.stdin.end();
    } catch {
      // Ignore shutdown races.
    }
    if (!proc.killed) {
      proc.kill('SIGTERM');
    }
    this.process = null;
    this.exited = true;
  }

  private async sendControl<T>(payload: Record<string, unknown>, timeoutMs: number): Promise<T> {
    const proc = await this.ensureStarted();
    const id = randomUUID();

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingControls.delete(id);
        reject(createCodeError('PI_HEALTH_TIMEOUT', `Pi health check timed out after ${timeoutMs}ms.`));
      }, timeoutMs);

      const pending: PendingControl = {
        id,
        timeout,
        resolve: (data) => {
          clearTimeout(timeout);
          resolve(data as T);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      };
      this.pendingControls.set(id, pending);
      this.writeJson(proc, { ...payload, id });
    });
  }

  private async ensureStarted(): Promise<SpawnProcess> {
    if (this.process && !this.exited) return this.process;

    const env = {
      ...process.env,
      ...(typeof this.env === 'function' ? await this.env() : this.env),
    };
    const missingEnvKeys = this.requiredEnvKeys.filter((key) => !env[key]);
    if (missingEnvKeys.length > 0) {
      throw createCodeError(
        'PI_LLM_ENV_MISSING',
        `Pi runtime is missing required LLM environment: ${missingEnvKeys.join(', ')}.`,
        'Set the missing variables in your shell, .env.local, or FINAGENT_ENV_FILE before launching Electron.'
      );
    }

    this.exited = false;
    let proc: SpawnProcess;
    try {
      proc = this.spawnProcess(this.command, [...this.args], {
        cwd: this.cwd,
        env,
        stdio: 'pipe',
        shell: false,
      });
    } catch (error) {
      throw normalizeSpawnError(error, this.command);
    }
    this.process = proc;
    this.stdoutBuffer = '';
    this.stderrBuffer = '';

    proc.stdout.on('data', (chunk) => this.consumeStdout(String(chunk)));
    proc.stderr.on('data', (chunk) => this.consumeStderr(String(chunk)));
    proc.on('error', (error) => this.handleExit(normalizeSpawnError(error, this.command)));
    proc.on('exit', (code, signal) => {
      this.handleExit(createCodeError(
        'PI_RUNTIME_EXITED',
        `Pi runtime exited${code === null ? '' : ` with code ${code}`}${signal ? ` and signal ${signal}` : ''}.`
      ));
    });

    return proc;
  }

  private writeJson(proc: SpawnProcess, payload: Record<string, unknown>, pending?: PendingPrompt) {
    const line = `${JSON.stringify(payload)}\n`;
    let ok = false;
    try {
      ok = proc.stdin.write(line);
    } catch (error) {
      const normalized = normalizeSpawnError(error, this.command);
      if (pending) {
        this.finishPrompt(pending, normalized);
        return;
      }
      throw normalized;
    }
    pending?.trace.push({
      id: randomUUID(),
      type: 'jsonl_request',
      timestamp: this.now(),
      data: redactPromptPayload(payload),
    });
    if (!ok) {
      pending?.trace.push({
        id: randomUUID(),
        type: 'stdin_backpressure',
        timestamp: this.now(),
        message: 'Pi runtime stdin reported backpressure.',
      });
    }
  }

  private consumeStdout(chunk: string) {
    this.stdoutBuffer += chunk;
    let newlineIndex = this.stdoutBuffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line.length > 0) {
        this.handleStdoutLine(line);
      }
      newlineIndex = this.stdoutBuffer.indexOf('\n');
    }
  }

  private consumeStderr(chunk: string) {
    this.stderrBuffer += chunk;
    let newlineIndex = this.stderrBuffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = this.stderrBuffer.slice(0, newlineIndex).trim();
      this.stderrBuffer = this.stderrBuffer.slice(newlineIndex + 1);
      if (line.length > 0) {
        this.onLog({
          level: 'error',
          message: line,
          timestamp: this.now(),
          data: { source: 'pi-stderr' },
        });
        for (const pending of this.pendingPrompts.values()) {
          pending.trace.push({
            id: randomUUID(),
            type: 'stderr',
            timestamp: this.now(),
            message: line,
          });
        }
      }
      newlineIndex = this.stderrBuffer.indexOf('\n');
    }
  }

  private handleStdoutLine(line: string) {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch (error) {
      this.rejectAll(createCodeError('PI_PROTOCOL_ERROR', `Pi emitted malformed JSONL: ${line}`));
      return;
    }

    const pending = this.findPending(event);
    const control = this.findControl(event);
    if (control) {
      clearTimeout(control.timeout);
      this.pendingControls.delete(control.id);
      if (event.type === 'error') {
        control.reject(createCodeError('PI_RUNTIME_ERROR', String(event.message ?? 'Pi runtime error.')));
      } else {
        control.resolve(event.data);
      }
    }

    if (!pending) return;

    pending.trace.push({
      id: randomUUID(),
      type: String(event.type ?? 'unknown'),
      timestamp: this.now(),
      data: event,
    });

    if (isPromptResponse(event)) {
      if (event.success === false) {
        this.finishPrompt(
          pending,
          createCodeError('PI_RUNTIME_ERROR', String(event.error ?? event.message ?? 'Pi runtime rejected the prompt.'))
        );
      }
      return;
    }

    const text = extractEventText(event);
    if (text) pending.answerParts.push(text);

    const finalAnswer = extractFinalAnswer(event);
    if (finalAnswer) {
      pending.finalAnswer = finalAnswer;
    }

    this.recordToolEvent(pending, event);

    if (pending.onEvent) {
      pending.onEvent(event);
    }

    if (event.type === 'error') {
      this.finishPrompt(pending, createCodeError('PI_RUNTIME_ERROR', String(event.message ?? 'Pi runtime error.')));
      return;
    }

    if (event.type === 'agent_end') {
      this.finishPrompt(pending);
    }
  }

  private recordToolEvent(pending: PendingPrompt, event: Record<string, unknown>) {
    if (event.type !== 'tool_execution_start' && event.type !== 'tool_execution_end') return;

    const toolId = String(event.toolCallId ?? event.callId ?? event.id ?? `${pending.id}-tool-${pending.toolCalls.length + 1}`);
    const existing = pending.toolCalls.find((toolCall) => toolCall.id === toolId);

    if (event.type === 'tool_execution_start') {
      if (!existing) {
        pending.toolCalls.push({
          id: toolId,
          toolName: String(event.toolName ?? event.name ?? 'unknown'),
          args: readRecord(event.args ?? event.input),
          startedAt: this.now(),
          status: 'success',
        });
        const toolTimeout = setTimeout(() => {
          this.finishPrompt(
            pending,
            createCodeError('PI_TOOL_TIMEOUT', `Pi tool call ${toolId} timed out after ${this.singleToolTimeoutMs}ms.`)
          );
        }, this.singleToolTimeoutMs);
        pending.toolTimeouts.set(toolId, toolTimeout);
      }
      if (pending.toolCalls.length > this.maxToolCalls) {
        this.finishPrompt(
          pending,
          createCodeError('PI_TOOL_LIMIT_EXCEEDED', `Pi exceeded the maximum of ${this.maxToolCalls} tool calls.`)
        );
      }
      return;
    }

    if (existing) {
      const toolTimeout = pending.toolTimeouts.get(toolId);
      if (toolTimeout) {
        clearTimeout(toolTimeout);
        pending.toolTimeouts.delete(toolId);
      }
      existing.completedAt = this.now();
      existing.status = event.error || event.isError ? 'error' : 'success';
      existing.result = event.result ?? event.output;
      if (event.error) {
        existing.error = {
          code: 'PI_TOOL_ERROR',
          message: String(event.error),
        };
      }
    }
  }

  private findPending(event: Record<string, unknown>) {
    const id = typeof event.id === 'string' ? event.id : typeof event.requestId === 'string' ? event.requestId : undefined;
    if (id && this.pendingPrompts.has(id)) return this.pendingPrompts.get(id);
    if (this.pendingPrompts.size === 1) return Array.from(this.pendingPrompts.values())[0];
    return undefined;
  }

  private findControl(event: Record<string, unknown>) {
    const id = typeof event.id === 'string' ? event.id : typeof event.requestId === 'string' ? event.requestId : undefined;
    if (!id) return undefined;
    return this.pendingControls.get(id);
  }

  private finishPrompt(pending: PendingPrompt, error?: unknown) {
    clearTimeout(pending.timeout);
    for (const timeout of pending.toolTimeouts.values()) {
      clearTimeout(timeout);
    }
    pending.toolTimeouts.clear();
    this.pendingPrompts.delete(pending.id);
    if (error) {
      pending.reject(error);
      return;
    }
    pending.resolve({
      answer: pending.finalAnswer ?? pending.answerParts.join('').trim(),
      toolCalls: pending.toolCalls,
      trace: pending.trace,
      aborted: pending.abortRequested,
    });
  }

  private activePrompt(): PendingPrompt | undefined {
    return Array.from(this.pendingPrompts.values())[0];
  }

  private handleExit(error: unknown) {
    this.exited = true;
    this.process = null;
    this.rejectAll(error);
  }

  private rejectAll(error: unknown) {
    for (const pending of this.pendingPrompts.values()) {
      clearTimeout(pending.timeout);
      for (const timeout of pending.toolTimeouts.values()) {
        clearTimeout(timeout);
      }
      pending.toolTimeouts.clear();
      pending.reject(error);
    }
    this.pendingPrompts.clear();
    for (const pending of this.pendingControls.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingControls.clear();
  }
}

function parseArgs(value: string | undefined) {
  if (!value) return undefined;
  return value.split(' ').map((part) => part.trim()).filter(Boolean);
}

function readDefaultPiCommand() {
  return process.env.FINAGENT_PI_COMMAND ?? 'bunx';
}

function readDefaultPiArgs() {
  const explicitArgs = parseArgs(process.env.FINAGENT_PI_ARGS);
  if (explicitArgs) return explicitArgs;

  const args = [
    '@mariozechner/pi-coding-agent',
    '--mode',
    'rpc',
    '--provider',
    process.env.FINAGENT_PI_PROVIDER ?? 'anthropic',
  ];

  const model = process.env.FINAGENT_PI_MODEL ?? process.env.ANTHROPIC_MODEL;
  if (model) {
    args.push('--model', model);
  }

  args.push('--extension', '.pi/extensions/finagent/index.ts');
  return args;
}

function extractEventText(event: Record<string, unknown>) {
  const assistantMessageEvent = readRecord(event.assistantMessageEvent);
  if (assistantMessageEvent.type === 'text_delta' && typeof assistantMessageEvent.delta === 'string') {
    return assistantMessageEvent.delta;
  }
  if (assistantMessageEvent.type === 'text_end' && typeof assistantMessageEvent.content === 'string') {
    return assistantMessageEvent.content;
  }
  for (const key of ['text', 'content', 'message', 'delta']) {
    if (typeof event[key] === 'string') return event[key];
  }
  const data = event.data;
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    for (const key of ['text', 'content', 'message', 'delta']) {
      if (typeof record[key] === 'string') return record[key];
    }
  }
  return '';
}

function extractFinalAnswer(event: Record<string, unknown>) {
  if (event.type === 'agent_end') {
    return extractAssistantTextFromMessages(event.messages);
  }

  const message = readRecord(event.message);
  if (message.role === 'assistant') {
    const text = extractAssistantTextFromMessageRecord(message);
    if (text) return text;
  }

  return '';
}

function extractAssistantTextFromMessages(messages: unknown) {
  if (!Array.isArray(messages)) return '';
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const text = extractAssistantTextFromMessageRecord(messages[index]);
    if (text) return text;
  }
  return '';
}

function extractAssistantTextFromMessageRecord(message: unknown) {
  const record = readRecord(message);
  if (record.role !== 'assistant') return '';
  return flattenTextContent(record.content);
}

function flattenTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  const texts = content.flatMap((item) => {
    const record = readRecord(item);
    if (record.type === 'text' && typeof record.text === 'string') {
      return [record.text];
    }
    return [];
  });

  return texts.join('').trim();
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function redactPromptPayload(payload: Record<string, unknown>) {
  if (payload.type !== 'prompt') return payload;
  return {
    ...payload,
    message: typeof payload.message === 'string' ? `[${payload.message.length} chars]` : payload.message,
  };
}

function isPromptResponse(event: Record<string, unknown>): event is Record<string, unknown> & {
  type: 'response';
  command: 'prompt';
  success: boolean;
} {
  return event.type === 'response' && event.command === 'prompt' && typeof event.success === 'boolean';
}

function normalizeSpawnError(error: unknown, command: string) {
  if (isNodeError(error) && error.code === 'ENOENT') {
    return createCodeError(
      'PI_RUNTIME_NOT_FOUND',
      `Pi runtime command was not found: ${command}.`,
      'Install the Pi CLI or set FINAGENT_PI_COMMAND to a JSONL/stdio runtime command before launching Electron.'
    );
  }

  if (isNodeError(error) && error.code === 'EACCES') {
    return createCodeError(
      'PI_RUNTIME_NOT_EXECUTABLE',
      `Pi runtime command is not executable: ${command}.`,
      'Fix the runtime file permissions or set FINAGENT_PI_COMMAND to an executable JSONL/stdio runtime command.'
    );
  }

  return error;
}

function isNodeError(error: unknown): error is Error & { code: string } {
  return error instanceof Error && typeof (error as { code?: unknown }).code === 'string';
}

export { readDefaultPiArgs, readDefaultPiCommand };
