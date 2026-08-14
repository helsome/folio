/**
 * V5 unified notification domain (spec §56–57).
 *
 * One event shape for every notification source; the main process owns the
 * dispatcher (OS notification + in-app). Modules never each build their own
 * notification system.
 */

export type NotificationSource =
  | 'alert'
  | 'daily-brief'
  | 'automation'
  | 'research-diff'
  | 'thesis-impact';

export type NotificationSeverity = 'info' | 'warning' | 'critical';

export interface NotificationEvent {
  id: string;
  source: NotificationSource;
  title: string;
  message: string;
  symbol?: string;
  at: number;
  severity: NotificationSeverity;
  /** Source-specific structured payload (never secrets). */
  payload?: Record<string, unknown>;
}
