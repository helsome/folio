import React, { useEffect, useState } from 'react';
import { Sidebar } from './Sidebar';
import { ChatArea } from '../chat/ChatArea';
import { TitleBar } from './TitleBar';
import {
  FinagentClientProvider,
  fallbackClient,
  useFinagentClient,
  type FinagentClient,
} from '../../client';
import type { LongBridgeStatus } from '@finagent/core';

interface AppShellProps {
  client?: FinagentClient;
}

export const AppShell: React.FC<AppShellProps> = ({ client = fallbackClient }) => {
  return (
    <FinagentClientProvider client={client}>
      <div className="flex flex-col h-screen bg-[oklch(var(--bg-primary))]">
        <TitleBar />
        <LongBridgeBanner />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <ChatArea />
        </div>
      </div>
    </FinagentClientProvider>
  );
};

const LongBridgeBanner: React.FC = () => {
  const [status, setStatus] = useState<LongBridgeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const client = useFinagentClient();

  useEffect(() => {
    let mounted = true;
    client.longbridge.getStatus().then((result) => {
      if (!mounted) return;
      if (result.ok) {
        setStatus(result.data);
        setError(null);
      } else {
        setStatus(null);
        setError(result.error.message);
      }
    });
    return () => {
      mounted = false;
    };
  }, [client]);

  if (!error && (!status || status.available)) {
    return null;
  }

  const message = error ?? status?.message ?? 'LongBridge CLI status is unavailable.';
  const action = status?.action ?? 'Install LongBridge CLI and run longbridge auth login.';
  const title = status?.status === 'rate_limited' ? 'LongBridge paused: ' : 'LongBridge setup needed: ';

  return (
    <div className="border-b border-yellow-500/30 bg-yellow-500/10 px-4 py-2 text-sm text-[oklch(var(--text-primary))]">
      <span className="font-medium">{title}</span>
      <span>{message}</span>
      <span className="ml-2 text-[oklch(var(--text-secondary))]">{action}</span>
    </div>
  );
};
