import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { Alert } from '@finagent/core';

// Use dynamic import for zod to avoid issues
const ALERTS_DIR = join(process.env.HOME || '', '.finagent');
const ALERTS_PATH = join(ALERTS_DIR, 'alerts.json');

async function ensureDirectory(): Promise<void> {
  try {
    await mkdir(ALERTS_DIR, { recursive: true });
  } catch {
    // Directory already exists
  }
}

export async function loadAlerts(): Promise<Alert[]> {
  try {
    await ensureDirectory();
    const data = await readFile(ALERTS_PATH, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export async function saveAlerts(alerts: Alert[]): Promise<void> {
  await ensureDirectory();
  await writeFile(ALERTS_PATH, JSON.stringify(alerts, null, 2));
}

export async function addAlert(alert: Alert): Promise<void> {
  const alerts = await loadAlerts();
  alerts.push(alert);
  await saveAlerts(alerts);
}

export async function removeAlert(alertId: string): Promise<void> {
  const alerts = await loadAlerts();
  const filtered = alerts.filter((a) => a.id !== alertId);
  await saveAlerts(filtered);
}

export async function updateAlert(alertId: string, updates: Partial<Alert>): Promise<void> {
  const alerts = await loadAlerts();
  const index = alerts.findIndex((a) => a.id === alertId);
  if (index !== -1) {
    alerts[index] = { ...alerts[index], ...updates };
    await saveAlerts(alerts);
  }
}