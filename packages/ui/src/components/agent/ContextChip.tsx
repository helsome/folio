import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAtom, useSetAtom } from 'jotai';
import {
  activeSymbolAtom,
  activeViewAtom,
  navSectionAtom,
  type NavSection,
} from '../../atoms';
import { compareSymbolsAtom } from '../../atoms/compareAtoms';

/** Section label key for the context chip (spec §24: "NVDA · Research"). */
const SECTION_LABEL_KEY: Partial<Record<NavSection, string>> = {
  research: 'navigation.research',
  thesis: 'navigation.thesis',
  portfolio: 'navigation.portfolio',
  compare: 'navigation.compare',
  alerts: 'navigation.alerts',
  discover: 'navigation.discover',
  skills: 'navigation.skills',
  settings: 'navigation.settings',
  evaluation: 'navigation.evaluation',
  today: 'navigation.today',
};

/**
 * Current workspace focus shown in the agent header. Composes the app section
 * with the relevant financial object: "NVDA.US · Research", "Portfolio",
 * "Compare · NVDA / AMD". Clicking the clear affordance clears the symbol.
 */
export const ContextChip: React.FC = () => {
  const { t } = useTranslation();
  const [activeSymbol] = useAtom(activeSymbolAtom);
  const [activeView] = useAtom(activeViewAtom);
  const [navSection] = useAtom(navSectionAtom);
  const [compareSymbols] = useAtom(compareSymbolsAtom);
  const setActiveSymbol = useSetAtom(activeSymbolAtom);

  const workspaceSection = navSection === 'sessions' || navSection === 'watchlist';
  const sectionLabel = workspaceSection
    ? t('navigation.workspace')
    : SECTION_LABEL_KEY[navSection]
      ? t(SECTION_LABEL_KEY[navSection] as string)
      : null;

  // Compare context takes precedence over the single active symbol.
  if (navSection === 'compare' && compareSymbols.length > 0) {
    return (
      <div
        data-testid="context-chip"
        className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(var(--accent-rgb),0.22)] bg-[var(--mac-blue-soft)] px-2.5 py-1 text-[11px] font-medium"
      >
        <span className="font-semibold text-foreground">
          {t('navigation.compare')} · {compareSymbols.join(' / ')}
        </span>
      </div>
    );
  }

  if (!activeSymbol && !sectionLabel) {
    return (
      <div
        data-testid="context-chip"
        className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-[var(--mac-border)] px-2.5 py-1 text-[11px] text-foreground/38"
      >
        {t('agent.context.none')}
      </div>
    );
  }

  const parts: string[] = [];
  if (sectionLabel) parts.push(sectionLabel);
  if (activeSymbol) parts.push(activeSymbol);
  else if (workspaceSection && !activeSymbol) parts.push(activeView);

  return (
    <div
      data-testid="context-chip"
      className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(var(--accent-rgb),0.22)] bg-[var(--mac-blue-soft)] px-2.5 py-1 text-[11px] font-medium"
    >
      {parts.length === 1 ? (
        <span className="font-semibold text-foreground">{parts[0]}</span>
      ) : (
        <>
          <span className="text-foreground/72">{parts[0]}</span>
          <span className="text-foreground/34">·</span>
          <span className="font-semibold text-foreground">{parts[1]}</span>
        </>
      )}
      {activeSymbol && (
        <button
          type="button"
          onClick={() => setActiveSymbol(null)}
          className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full text-foreground/44 transition-smooth hover:bg-foreground/10 hover:text-foreground"
          aria-label={t('agent.context.clear')}
        >
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden="true">
            <path d="M2 2l5 5M7 2L2 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
};
