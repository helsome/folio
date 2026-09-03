import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { FolderPlus } from 'lucide-react';
import { useFinagentClient, type SkillListItem } from '../../client';
import { loadSkillReadiness, skillReadinessAtom } from '../../atoms/skillReadinessAtoms';
import { filterSkills, SKILL_STATUS_FILTERS, type SkillStatusFilter } from './skillFilters';
import { useSkillToggle } from './useSkillToggle';
import { SkillList } from './SkillList';
import { SkillDetailDrawer } from './SkillDetailDrawer';

const SKILL_FILTER_LABEL_KEY: Record<SkillStatusFilter, string> = {
  all: 'settings.skills.filterAll',
  ready: 'settings.skills.filterReady',
  partial: 'settings.skills.filterPartial',
  disabled: 'settings.skills.filterDisabled',
};

/** Skills home: search + status chips + rows, with a detail drawer. */
export const SkillsView: React.FC = () => {
  const { t } = useTranslation();
  const client = useFinagentClient();
  const [skills, setSkills] = useState<SkillListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [skillReadiness, setSkillReadiness] = useAtom(skillReadinessAtom);
  const [installing, setInstalling] = useState(false);
  const [installMessage, setInstallMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<SkillStatusFilter>('all');

  const [openSkillId, setOpenSkillId] = useState<string | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const { togglingId, toggleError, toggle } = useSkillToggle(client, setSkills);

  const loadSkills = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await client.skills.list();
    setLoading(false);
    if (result.ok) {
      setSkills(result.data);
    } else {
      setError(result.error.message);
    }
  }, [client]);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  useEffect(() => {
    void loadSkillReadiness().then(setSkillReadiness);
  }, [setSkillReadiness]);

  const filtered = useMemo(
    () => filterSkills(skills, skillReadiness, query, status),
    [skills, skillReadiness, query, status]
  );

  const openSkill = openSkillId ? skills.find((skill) => skill.id === openSkillId) : undefined;

  const openDrawer = useCallback((skill: SkillListItem, trigger: HTMLElement) => {
    triggerRef.current = trigger;
    setOpenSkillId(skill.id);
  }, []);

  const closeDrawer = useCallback(() => {
    setOpenSkillId(null);
    triggerRef.current?.focus();
    triggerRef.current = null;
  }, []);

  const handleRemoved = useCallback(async () => {
    setOpenSkillId(null);
    triggerRef.current = null;
    await loadSkills();
    setSkillReadiness(await loadSkillReadiness());
  }, [loadSkills, setSkillReadiness]);

  const handleToggle = useCallback(
    (skill: SkillListItem) => {
      void toggle(skill);
    },
    [toggle]
  );

  const installLocalSkill = useCallback(async () => {
    setInstalling(true);
    setInstallMessage(null);
    const result = await client.skills.installLocal();
    setInstalling(false);
    if (!result.ok) {
      setInstallMessage({ tone: 'error', text: result.error.message });
      return;
    }
    if (result.data.canceled) return;
    await loadSkills();
    setSkillReadiness(await loadSkillReadiness());
    setInstallMessage({
      tone: 'success',
      text: t('settings.skills.installSuccess', { name: result.data.name ?? result.data.skillId }),
    });
  }, [client, loadSkills, setSkillReadiness, t]);

  return (
    <div className="max-w-4xl">
      <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
        <div className="flex min-w-0 items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground/40"
            >
              <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
              <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('settings.skills.searchPlaceholder')}
              aria-label={t('settings.skills.searchAria')}
              data-testid="skills-search"
              className="h-9 w-full rounded-[8px] border border-input bg-background pl-8 pr-3 text-[13px] text-foreground placeholder:text-foreground/40 transition-smooth hover:border-border-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <button
            type="button"
            data-testid="skills-install-local"
            onClick={() => void installLocalSkill()}
            disabled={installing}
            aria-busy={installing}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[8px] border border-input bg-background px-3 text-[12px] font-medium text-foreground/72 transition-smooth hover:border-border-strong hover:bg-surface-hover hover:text-foreground active:scale-[0.98] disabled:cursor-wait disabled:opacity-55 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <FolderPlus className="h-4 w-4" aria-hidden="true" />
            {installing ? t('settings.skills.installing') : t('settings.skills.installLocal')}
          </button>
        </div>

        <div role="group" aria-label={t('settings.skills.filterGroupAria')} className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
          {SKILL_STATUS_FILTERS.map((filter) => {
            const active = status === filter.value;
            return (
              <button
                key={filter.value}
                type="button"
                aria-pressed={active}
                data-testid={`skills-filter-${filter.value}`}
                onClick={() => setStatus(filter.value)}
                className={`rounded-full border px-3 py-1 text-[12px] font-medium transition-smooth focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                  active
                    ? 'border-accent bg-accent text-white'
                    : 'border-border text-foreground/64 hover:border-border-strong hover:bg-surface-hover hover:text-foreground active:scale-95'
                }`}
              >
                {t(SKILL_FILTER_LABEL_KEY[filter.value])}
              </button>
            );
          })}
        </div>
        {installMessage && (
          <div
            role={installMessage.tone === 'error' ? 'alert' : 'status'}
            data-testid="skills-install-message"
            className={`mt-3 text-[12px] ${installMessage.tone === 'error' ? 'text-destructive' : 'text-[var(--mac-green)]'}`}
          >
            {installMessage.text}
          </div>
        )}
      </div>

      <div className="mt-5">
        {loading ? (
          <div className="rounded-xl border border-border bg-surface py-12 text-center text-[13px] text-foreground/48">{t('settings.skills.loading')}</div>
        ) : error ? (
          <div className="rounded-xl border border-border bg-surface py-12 text-center">
            <div role="alert" className="text-[13px] text-destructive">
              {error}
            </div>
            <button
              type="button"
              onClick={() => void loadSkills()}
              className="mt-3 rounded-[8px] border border-input px-3 py-1.5 text-[12px] font-medium text-foreground/72 transition-smooth hover:bg-surface-hover hover:text-foreground active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {t('settings.skills.retry')}
            </button>
          </div>
        ) : skills.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface py-12 text-center text-[13px] text-foreground/48">{t('settings.skills.noneInstalled')}</div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface py-12 text-center text-[13px] text-foreground/48">
            {t('settings.skills.noMatch')}
          </div>
        ) : (
          <SkillList
            skills={filtered}
            readiness={skillReadiness}
            togglingId={togglingId}
            toggleError={toggleError}
            onToggle={handleToggle}
            onOpen={openDrawer}
          />
        )}
      </div>

      {openSkill && (
        <SkillDetailDrawer
          key={openSkill.id}
          skill={openSkill}
          readiness={skillReadiness.find((entry) => entry.skillId === openSkill.id)}
          onClose={closeDrawer}
          togglingId={togglingId}
          toggleError={toggleError}
          onToggle={handleToggle}
          onRemoved={() => void handleRemoved()}
        />
      )}
    </div>
  );
};
