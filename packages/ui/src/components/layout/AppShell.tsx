import React from 'react';
import { Sidebar } from './Sidebar';
import { ChatArea } from '../chat/ChatArea';
import { TitleBar } from './TitleBar';

export const AppShell: React.FC = () => {
  return (
    <div className="flex flex-col h-screen bg-[oklch(var(--bg-primary))]">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <ChatArea />
      </div>
    </div>
  );
};