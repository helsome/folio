import React, { useState, useEffect } from 'react';

export const TitleBar: React.FC = () => {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const checkMaximized = async () => {
      if (window.electronAPI?.window) {
        const maximized = await window.electronAPI.window.isMaximized();
        setIsMaximized(maximized);
      }
    };
    checkMaximized();
  }, []);

  const handleMinimize = () => window.electronAPI?.window.minimize();
  const handleMaximize = async () => {
    await window.electronAPI?.window.maximize();
    setIsMaximized(!isMaximized);
  };
  const handleClose = () => window.electronAPI?.window.close();

  return (
    <header
      data-tauri-drag-region
      className="h-8 flex items-center justify-between bg-[oklch(var(--bg-secondary))] border-b border-[oklch(var(--bg-primary))]"
    >
      <div className="flex items-center px-4" data-tauri-drag-region>
        <span className="text-sm font-medium">Finance Agent</span>
      </div>
      <div className="flex h-full">
        <button
          onClick={handleMinimize}
          className="h-full px-4 hover:bg-[oklch(var(--bg-primary))] transition-colors"
          aria-label="Minimize"
        >
          <span className="text-xs">─</span>
        </button>
        <button
          onClick={handleMaximize}
          className="h-full px-4 hover:bg-[oklch(var(--bg-primary))] transition-colors"
          aria-label="Maximize"
        >
          <span className="text-xs">{isMaximized ? '❐' : '□'}</span>
        </button>
        <button
          onClick={handleClose}
          className="h-full px-4 hover:bg-red-500 hover:text-white transition-colors"
          aria-label="Close"
        >
          <span className="text-xs">×</span>
        </button>
      </div>
    </header>
  );
};