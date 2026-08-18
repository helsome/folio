import React from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Presentational shell for a "Today" dashboard section (spec §31). Each
 * section renders its own loading/error/empty content via `<SectionState>`;
 * the shell only owns the title, the optional right-aligned action, and the
 * quiet section chrome shared with the rest of the app.
 */

interface TodaySectionProps {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}

export const TodaySection: React.FC<TodaySectionProps> = ({ title, action, children }) => (
  <section className="border-t border-border px-1 py-4 first:border-t-0">
    <header className="mb-3 flex items-center justify-between gap-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-foreground/48">{title}</h3>
      {action}
    </header>
    {children}
  </section>
)

/** One of the three non-data states a section can show. */
export const SectionState: React.FC<{ kind: 'loading' | 'error' | 'empty'; message?: string }> = ({ kind, message }) => {
  const { t } = useTranslation()
  if (kind === 'loading') {
    return <div className="py-2 text-[13px] text-foreground/42">{t('today.sectionLoading')}</div>
  }
  if (kind === 'error') {
    return (
      <div className="py-2 text-[13px] text-[var(--mac-red)]">
        {message ?? t('today.sectionError')}
      </div>
    )
  }
  return (
    <div className="py-2 text-[13px] text-foreground/42">{message ?? t('today.sectionEmpty')}</div>
  )
}
