import React, { useState, useEffect } from 'react';
import { useFinagentClient } from '../../client';
import { Dialog } from '../primitives/Dialog';
import { AboutView } from '../about/AboutView';

const folioLogoUrl = new URL('../../assets/folio-logo.png', import.meta.url).href;

export const TitleBar: React.FC = () => {
  const client = useFinagentClient();
  const [isMaximized, setIsMaximized] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  useEffect(() => {
    const checkMaximized = async () => {
      if (client.window) {
        const maximized = await client.window.isMaximized();
        setIsMaximized(maximized);
      }
    };
    checkMaximized();
  }, [client]);

  const handleMinimize = () => client.window?.minimize();
  const handleMaximize = async () => {
    await client.window?.maximize();
    setIsMaximized(!isMaximized);
  };
  const handleClose = () => client.window?.close();

  return (
    <header className="mac-titlebar z-titlebar flex items-center justify-between">
      <div className="flex h-full items-center gap-2 px-3">
        <button
          onClick={handleClose}
          className="group flex h-5 w-5 items-center justify-center rounded-full transition-smooth hover:bg-black/5"
          aria-label="Close"
        >
          <span className="mac-traffic-light mac-traffic-light-close" />
        </button>
        <button
          onClick={handleMinimize}
          className="group flex h-5 w-5 items-center justify-center rounded-full transition-smooth hover:bg-black/5"
          aria-label="Minimize"
        >
          <span className="mac-traffic-light mac-traffic-light-minimize" />
        </button>
        <button
          onClick={handleMaximize}
          className="group flex h-5 w-5 items-center justify-center rounded-full transition-smooth hover:bg-black/5"
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
        >
          <span className="mac-traffic-light mac-traffic-light-maximize" />
        </button>
      </div>

      <div
        data-tauri-drag-region
        className="flex flex-1 items-center justify-center self-stretch"
      >
        <div className="flex items-center gap-2">
          <img
            src={folioLogoUrl}
            alt=""
            className="h-[18px] w-[18px] rounded-[5px] shadow-sm"
            draggable={false}
          />
          <span className="text-[13px] font-semibold text-foreground/78">Folio</span>
        </div>
      </div>

      <div className="flex h-full w-[4.8rem] items-center justify-end pr-3">
        <button
          type="button"
          onClick={() => setAboutOpen(true)}
          aria-label="About Folio"
          className="flex h-5 w-5 items-center justify-center rounded text-foreground/50 transition-smooth hover:bg-black/5 hover:text-foreground"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M8 7.2v3M8 5.4v.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <Dialog open={aboutOpen} onClose={() => setAboutOpen(false)} title="About Folio">
        <AboutView />
      </Dialog>
    </header>
  );
};
