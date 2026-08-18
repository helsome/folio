import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ResearchReport } from '@finagent/core';
import { loadExportMarkdown, loadShareCard } from '../../atoms/exportAtoms';

/**
 * Export & share menu for a research report (spec §54–55).
 *
 * Four actions, all fed exclusively by the report's own content rendered
 * main-side: Copy Markdown, Download .md, Copy share text, Download share
 * card (.svg). Never touches portfolio/account data — the shared renderers
 * only see the report (see packages/shared/src/export/privacy.ts).
 */

interface ExportMenuProps {
  report: ResearchReport;
}

type MenuAction = 'markdown-copy' | 'markdown-download' | 'share-copy' | 'share-download';

const MENU_ITEMS: ReadonlyArray<{ id: MenuAction; labelKey: string; testId: string }> = [
  { id: 'markdown-copy', labelKey: 'copyMarkdown', testId: 'export-copy-markdown' },
  { id: 'markdown-download', labelKey: 'downloadMarkdown', testId: 'export-download-markdown' },
  { id: 'share-copy', labelKey: 'copyShareText', testId: 'export-copy-share-text' },
  { id: 'share-download', labelKey: 'downloadShareCard', testId: 'export-download-card' },
];

function safeFileName(report: ResearchReport): string {
  return report.symbol.replace(/[^A-Z0-9.-]/gi, '_');
}

function downloadFile(name: string, content: string, type: string): boolean {
  if (typeof URL.createObjectURL !== 'function') return false;
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return true;
}

async function copyText(text: string): Promise<boolean> {
  if (!navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export const ExportMenu: React.FC<ExportMenuProps> = ({ report }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<MenuAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  async function runAction(action: MenuAction, attempt: () => Promise<boolean>): Promise<void> {
    setError(null);
    setBusy(action);
    try {
      const ok = await attempt();
      if (!ok) {
        // Keep the menu open so the failure reason stays visible.
        setError(t('research.export.unavailable'));
        return;
      }
      setOpen(false);
    } catch {
      setError(t('research.export.failed'));
    } finally {
      setBusy(null);
    }
  }

  const handleAction = (action: MenuAction): void => {
    void runAction(action, async () => {
      if (action === 'markdown-copy' || action === 'markdown-download') {
        const markdown = await loadExportMarkdown(report.id);
        if (markdown == null) return false;
        if (action === 'markdown-copy') return copyText(markdown);
        return downloadFile(`${safeFileName(report)}-research.md`, markdown, 'text/markdown');
      }
      const card = await loadShareCard(report.id);
      if (card == null) return false;
      if (action === 'share-copy') return copyText(card.text);
      return downloadFile(`${safeFileName(report)}-share-card.svg`, card.svg, 'image/svg+xml');
    });
  };

  return (
    <div className="relative" ref={menuRef} data-testid="export-menu">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-8 items-center justify-center rounded-[10px] border mac-list-row px-3 text-[12px] font-medium text-foreground transition-smooth hover:border-[var(--mac-border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35"
        data-testid="export-menu-trigger"
      >
        {t('common.export')}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-56 rounded-[10px] border mac-list-row bg-[var(--mac-window)] p-1 shadow-xl"
          data-testid="export-menu-panel"
        >
          {MENU_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={busy !== null}
              onClick={() => handleAction(item.id)}
              className="block w-full rounded-[8px] px-2.5 py-1.5 text-left text-[12px] text-foreground/85 transition-smooth hover:bg-[var(--mac-sidebar-hover)] disabled:cursor-not-allowed disabled:opacity-45"
              data-testid={item.testId}
            >
              {busy === item.id ? t('research.export.working') : t(`research.export.${item.labelKey}`)}
            </button>
          ))}
          {error && (
            <div className="px-2.5 pb-1.5 pt-1 text-[11px] text-negative" data-testid="export-menu-error">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
