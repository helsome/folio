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

export const positionSchema = z.object({
  symbol: symbolSchema,
  name: z.string(),
  quantity: z.number(),
  avgCost: z.number(),
  lastPrice: z.number(),
  marketValue: z.number(),
  unrealizedPnL: z.number(),
  unrealizedPnLPercent: z.number(),
});

export const portfolioSchema = z.object({
  totalValue: z.number(),
  cash: z.number(),
  positions: z.array(positionSchema),
});

export const alertSchema = z.object({
  id: z.string(),
  symbol: symbolSchema,
  type: z.enum(['price_above', 'price_below', 'news', 'rating_change']),
  value: z.number(),
  enabled: z.boolean(),
  triggered: z.boolean(),
  createdAt: z.number(),
  triggeredAt: z.number().optional(),
});

export const sessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(['idle', 'loading', 'error']),
  createdAt: z.number(),
  updatedAt: z.number(),
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
export { loadAlerts, saveAlerts, addAlert, removeAlert, updateAlert } from './storage/alerts';