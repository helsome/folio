import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process';
import type { AgentTraceEvent, ToolCallRecord } from '@finagent/core';
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
  env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
  healthTimeoutMs?: number;
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
}

interface PendingPrompt {
  id: string;
  answerParts: string[];
  finalAnswer?: string;
  toolCalls: ToolCallRecord[];
  trace: AgentTraceEvent[];
  toolTimeouts: Map<string, ReturnType<typeof setTimeout>>;
  timeout: ReturnType<typeof setTimeout>;
  resolve: (result: PiPromptResult) => void;
  reject: (error: unknown) => void;
}

interface PendingControl {
  id: string;
  timeout: ReturnType<typeof setTimeout>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

export class PiRpcClient {
  private readonly command: string;
  private readonly args: string[];
  private readonly cwd?: string;
  private readonly env?: NodeJS.ProcessEnv;
  private readonly requestTimeoutMs: number;
  private readonly healthTimeoutMs: number;
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
    this.args = options.args ?? readDefaultPiArgs();
    this.cwd = options.cwd ?? process.cwd();
    this.env = options.env;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 60_000;
    this.healthTimeoutMs = options.healthTimeoutMs ?? 5_000;
    this.singleToolTimeoutMs = options.singleToolTimeoutMs ?? 30_000;
    this.maxToolCalls = options.maxToolCalls ?? 8;
    this.requiredEnvKeys = options.requiredEnvKeys ?? [];
    this.now = options.now ?? Date.now;
    this.spawnProcess = options.spawnProcess ?? ((command, args, spawnOptions) =>
      spawn(command, args, spawnOptions));
    this.onLog = options.onLog ?? (() => undefined);
  }

  async healthCheck(): Promise<void> {
    await this.sendControl({ type: 'get_state' }, this.healthTimeoutMs);
  }

  async prompt(content: string): Promise<PiPromptResult> {
    const proc = this.ensureStarted();
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

  private sendControl(payload: Record<string, unknown>, timeoutMs: number): Promise<void> {
    const proc = this.ensureStarted();
    const id = randomUUID();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingControls.delete(id);
        reject(createCodeError('PI_HEALTH_TIMEOUT', `Pi health check timed out after ${timeoutMs}ms.`));
      }, timeoutMs);

      const pending: PendingControl = {
        id,
        timeout,
        resolve: () => {
          clearTimeout(timeout);
          resolve();
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

  private ensureStarted() {
    if (this.process && !this.exited) return this.process;

    const env = { ...process.env, ...this.env };
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
        control.resolve();
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
    });
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
