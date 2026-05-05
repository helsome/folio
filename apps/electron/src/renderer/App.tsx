import React from 'react';
import { AppShell } from '@finagent/ui';
import { finagentClient } from './finagentClient';

export default function App() {
  return <AppShell client={finagentClient} />;
}
