import React, { useEffect, useState } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';
const STORAGE_KEY = 'folio.theme';

function systemIsDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'light';
    } catch {
      return 'light';
    }
  });

  useEffect(() => {
    const apply = () => document.documentElement.classList.toggle('dark', mode === 'dark' || (mode === 'system' && systemIsDark()));
    apply();
    try { window.localStorage.setItem(STORAGE_KEY, mode); } catch { /* optional persistence */ }
    if (mode !== 'system' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = () => apply();
    media.addEventListener?.('change', listener);
    return () => media.removeEventListener?.('change', listener);
  }, [mode]);

  return <ThemeContext.Provider value={{ mode, setMode }}>{children}</ThemeContext.Provider>;
}

const ThemeContext = React.createContext<{ mode: ThemeMode; setMode: (mode: ThemeMode) => void }>({ mode: 'light', setMode: () => undefined });
export function useTheme() { return React.useContext(ThemeContext); }
