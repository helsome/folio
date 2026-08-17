import React, { useState } from 'react';
import { Info } from 'lucide-react';
import { Dialog } from '../primitives/Dialog';
import { AboutView } from '../about/AboutView';

const folioLogoUrl = new URL('../../assets/folio-logo.png', import.meta.url).href;

export const TitleBar: React.FC = () => {
  const [aboutOpen, setAboutOpen] = useState(false);

  return (
    <header className="mac-titlebar z-titlebar flex items-center justify-between">
      {/* BrowserWindow owns the native macOS traffic lights. Reserve their area
          instead of drawing a second set inside the renderer. */}
      <div className="h-full w-20 shrink-0" aria-hidden="true" />

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
          <Info className="h-3.5 w-3.5" strokeWidth={1.7} />
        </button>
      </div>

      <Dialog open={aboutOpen} onClose={() => setAboutOpen(false)} title="About Folio">
        <AboutView />
      </Dialog>
    </header>
  );
};
