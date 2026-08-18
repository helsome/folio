// Shared business logic - config validation, storage utilities

import { z } from 'zod';

// Symbol validation regex
const SYMBOL_REGEX = /^[A-Z]{1,5}\.(US|HK|SG|SH|SZ|HAS)$/;

export const symbolSchema = z.string().regex(SYMBOL_REGEX, {
  message: 'Invalid symbol format. Expected: AAPL.US, 0700.HK, 600519.SH',
});

export const quoteSchema = z.object({
  symbol: symbolSchema,
  lastPrice: z.number(),
  change: z.number(),
  changePercent: z.number(),
  volume: z.number(),
  timestamp: z.number(),
  high: z.number(),
  low: z.number(),
  open: z.number(),
  prevClose: z.number(),
});



export const sessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(['idle', 'running', 'error']),
  createdAt: z.number(),
  updatedAt: z.number(),
  runtimeSessionId: z.string().optional(),
  runtimeSessionPath: z.string().optional(),
  recentSymbols: z.array(z.string()).optional(),
});

// Config validation
export const appConfigSchema = z.object({
  longbridge: z.object({
    timeout: z.number().default(30000),
    cache: z.object({
      quoteTTL: z.number().default(30000), // 30s
      klineTTL: z.number().default(300000), // 5min
      portfolioTTL: z.number().default(120000), // 2min
    }).default({}),
  }).default({}),
  ui: z.object({
    theme: z.enum(['light', 'dark', 'system']).default('system'),
    fontSize: z.number().default(14),
  }).default({}),
  storage: z.object({
    sessionsPath: z.string().default('~/.finagent/sessions'),
    alertsPath: z.string().default('~/.finagent/alerts.json'),
    watchlistPath: z.string().default('~/.finagent/watchlist.json'),
  }).default({}),
});

export type AppConfig = z.infer<typeof appConfigSchema>;

let cachedConfig: AppConfig | null = null;

export function validateConfig(config: unknown): AppConfig {
  if (cachedConfig) return cachedConfig;
  cachedConfig = appConfigSchema.parse(config);
  return cachedConfig;
}

export function getDefaultConfig(): AppConfig {
  return appConfigSchema.parse({});
}

// Storage path helpers
export function getStoragePath(filename: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || '~';
  return `${home}/.finagent/${filename}`;
}

// Re-export storage utilities
export {
  JsonFileStore,
  SessionRepository,
  MessageRepository,
  RunRepository,
} from './storage/index.ts';
export {
  AgentKernel,
  SessionManager,
  RunManager,
  type AgentKernelOptions,
  type AgentProvider,
} from './kernel/index.ts';
export {
  LocalFinanceAgentBackend,
  LocalRuntimeAdapter,
  PiRuntimeAdapter,
  PiRpcClient,
  PiEventAdapter,
  FinanceToolRegistry,
  MarketDataService,
  routeFinanceIntent,
} from './agent/index.ts';
export type { PiPromptStream, PiPromptResult, PiState, PiStreamEvent } from './agent/pi-rpc-client.ts';

// Core error helpers used across services & the main process.
export { createCodeError, toApiError } from './agent/errors.ts';

// ── Folio V3 modules ───────────────────────────────────────────────────────
export * from './capabilities/index.ts';
export * from './research/index.ts';
export * from './thesis/index.ts';
export * from './compare/index.ts';
export * from './alerts/index.ts';
export * from './portfolio-risk/index.ts';
export * from './resources/index.ts';
export { isRecord, toFiniteNumber } from './guards.ts';
export * from './providers/index.ts';
export * from './diagnostics/index.ts';
export * from './screening/index.ts';
export * from './strategies/index.ts';
export * from './research-diff/index.ts';
export * from './outcome/index.ts';
export * from './portfolio-import/index.ts';
export * from './automation/index.ts';
export * from './performance/index.ts';
export * from './calibration/index.ts';
export * from './pulse/index.ts';
export * from './export/index.ts';
export * from './evaluation/index.ts';
